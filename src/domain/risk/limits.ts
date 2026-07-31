import type {
  PolicySeverity,
  RiskBucket,
  RiskLimitScope,
} from "@/domain/shared/types";
import { round2, round4 } from "@/domain/money/types";
import type { AssetExposure } from "@/domain/consolidation/consolidate";
import {
  groupExposureBy,
  totalFinancialValueBRL,
} from "@/domain/consolidation/consolidate";

/**
 * LIMITES DE RISCO
 * =================
 *
 * Todos os limites são avaliados sobre a EXPOSIÇÃO CONSOLIDADA. Um ativo a 3%
 * na Avenue e 3% em outra corretora soma 6% e viola o teto de 5% de uma ação
 * core — é exatamente esse o caso que o sistema existe para detectar.
 *
 * Nenhum limite é hardcoded: todos vêm da tabela `risk_limits`, editável pelo
 * gestor. Os valores iniciais do seed refletem a política descrita no briefing.
 */

export interface RiskLimit {
  readonly scope: RiskLimitScope;
  /** Chave do escopo: bucket, setor, país, moeda ou asset_type. `null` = todos. */
  readonly scopeKey: string | null;
  /**
   * Teto em % da carteira global (0-100). Acima disso é VIOLAÇÃO.
   *
   * `null` quando o limite só tem lado de piso — caixa, por exemplo, não tem
   * teto de risco: o problema com caixa é faltar, não sobrar.
   */
  readonly maxPercentage: number | null;
  /**
   * Início da faixa de atenção abaixo do teto, em %.
   *
   * Existe para separar ruído de mercado de decisão de rebalanceamento: uma
   * ação core que oscila de 4,9% para 5,1% não deveria virar violação e
   * disparar uma venda. Com warn=5,0 e max=5,5, a faixa entre os dois é
   * amarela — monitorar, não agir.
   *
   * Ausente: usa 90% do teto como padrão.
   */
  readonly warnPercentage?: number;
  /**
   * Piso de vigilância, em %. Abaixo disso o alerta é de SUBEXPOSIÇÃO.
   *
   * Nem todo risco é excesso. Um bucket de caixa que seca deixa a carteira sem
   * munição para oportunidade e sem colchão para resgate — é risco, e o teto
   * nunca o detectaria.
   *
   * Só se aplica a escopos AGREGADOS (bucket, setor, país, moeda). Em
   * SINGLE_ASSET é ignorado: um piso por ativo individual acusaria toda posição
   * pequena da carteira, o que não é informação.
   */
  readonly warnBelowPercentage?: number;
  /**
   * Tipos de ativo aos quais o limite NÃO se aplica.
   *
   * Existe para o caso do Tesouro: um teto de 5% por ativo faz sentido para
   * ação, não para título soberano — concentrar em NTN-B não é o mesmo risco
   * que concentrar numa empresa. A exposição soberana é monitorada por classe,
   * emissor, duration e vencimento, não por teto individual.
   */
  readonly exemptAssetTypes?: readonly string[];
}

/** Lado da faixa que disparou o alerta. */
export type RiskAlertDirection = "TETO" | "PISO";

export interface RiskAlert {
  readonly scope: RiskLimitScope;
  readonly scopeKey: string;
  /** Identificação legível do que violou. */
  readonly subject: string;
  readonly currentPercentage: number;
  readonly direction: RiskAlertDirection;
  /**
   * Limiar duro do lado que disparou. `null` quando não existe — é o caso do
   * piso de vigilância, que alerta mas nunca vira violação.
   */
  readonly limitPercentage: number | null;
  /** Limiar de atenção efetivamente aplicado, do lado que disparou. */
  readonly warnPercentage: number;
  /**
   * Distância até o limiar de referência, em pontos percentuais.
   * Positivo = acima (excesso). Negativo = abaixo (falta).
   */
  readonly excessPercentagePoints: number;
  /**
   * Distância em R$. Positivo = quanto reduzir para voltar ao limite.
   * Negativo = quanto falta aportar para alcançar o piso.
   */
  readonly excessBRL: number;
  readonly severity: PolicySeverity;
}

/** Fração do limite a partir da qual o alerta fica amarelo, se não houver warn. */
const ATTENTION_THRESHOLD = 0.9;

interface Trigger {
  readonly severity: PolicySeverity;
  readonly direction: RiskAlertDirection;
  /** Limiar de atenção do lado disparado. */
  readonly warn: number;
  /** Limiar duro do lado disparado, se houver. */
  readonly hard: number | null;
}

/**
 * Decide se e por qual lado da faixa o limite disparou.
 *
 * O piso tem precedência sobre o teto: se a exposição está abaixo do piso de
 * vigilância, o que importa reportar é a falta. Dizer ao mesmo tempo que há
 * folga contra o teto seria ruído.
 */
function triggerFor(current: number, limit: RiskLimit): Trigger | null {
  const floor = limit.warnBelowPercentage;
  if (floor !== undefined && current < floor) {
    return { severity: "ATENCAO", direction: "PISO", warn: floor, hard: null };
  }

  const max = limit.maxPercentage;
  if (max === null || max === undefined) return null;

  const warn = round4(limit.warnPercentage ?? max * ATTENTION_THRESHOLD);
  if (max <= 0) {
    return current > 0
      ? { severity: "VIOLACAO", direction: "TETO", warn, hard: max }
      : null;
  }
  if (current > max) {
    return { severity: "VIOLACAO", direction: "TETO", warn, hard: max };
  }
  if (current >= warn) {
    return { severity: "ATENCAO", direction: "TETO", warn, hard: max };
  }
  return null;
}

/** Monta o alerta a partir do gatilho, com os sinais coerentes com o lado. */
function buildAlert(
  scope: RiskLimitScope,
  scopeKey: string,
  subject: string,
  current: number,
  valueBRL: number,
  totalBRL: number,
  trigger: Trigger,
): RiskAlert {
  // Contra o limiar duro quando ele existe; contra o piso quando não existe.
  const referencia = trigger.hard ?? trigger.warn;
  return {
    scope,
    scopeKey,
    subject,
    currentPercentage: current,
    direction: trigger.direction,
    limitPercentage: trigger.hard,
    warnPercentage: trigger.warn,
    excessPercentagePoints: round4(current - referencia),
    excessBRL: round2(valueBRL - (totalBRL * referencia) / 100),
    severity: trigger.severity,
  };
}

/**
 * Avalia todos os limites configurados contra a carteira consolidada.
 * Retorna apenas o que merece atenção, ordenado por gravidade.
 */
export function evaluateRiskLimits(
  exposures: readonly AssetExposure[],
  limits: readonly RiskLimit[],
  assetTypeById: ReadonlyMap<string, string> = new Map(),
  /**
   * Setor CANÔNICO por ativo. Sem isso, o texto bruto da fonte é usado — e
   * "Governo Federal" (que é EMISSOR, não setor) dispararia o limite de
   * concentração setorial, que existe para medir exposição a um ramo da
   * economia.
   */
  canonicalSectorById: ReadonlyMap<string, string> = new Map(),
): RiskAlert[] {
  const totalBRL = totalFinancialValueBRL(exposures);
  if (totalBRL === 0) return [];

  const alerts: RiskAlert[] = [];

  for (const limit of limits) {
    switch (limit.scope) {
      case "SINGLE_ASSET":
        alerts.push(...checkSingleAsset(exposures, totalBRL, limit, assetTypeById));
        break;
      case "RISK_BUCKET":
        alerts.push(...checkBucketAggregate(exposures, totalBRL, limit));
        break;
      case "SECTOR":
        alerts.push(
          ...checkDimension(exposures, totalBRL, limit, (e) => {
            const canon = canonicalSectorById.get(e.assetId);
            // Setor não aplicável (soberano, caixa, RF bancária) não entra na
            // conta de concentração setorial.
            if (canon === "NAO_APLICAVEL") return "";
            return canon ?? e.sector ?? "Não classificado";
          }),
        );
        break;
      case "COUNTRY":
        alerts.push(...checkDimension(exposures, totalBRL, limit, (e) => e.country));
        break;
      case "CURRENCY":
        alerts.push(...checkDimension(exposures, totalBRL, limit, (e) => e.currency));
        break;
    }
  }

  const rank: Record<PolicySeverity, number> = { VIOLACAO: 0, ATENCAO: 1, OK: 2 };
  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return rank[a.severity] - rank[b.severity];
    return b.excessPercentagePoints - a.excessPercentagePoints;
  });
}

/**
 * Teto por ativo individual, aplicado conforme o risk_bucket.
 * `scopeKey` nulo aplica o teto a todos os ativos.
 */
function checkSingleAsset(
  exposures: readonly AssetExposure[],
  totalBRL: number,
  limit: RiskLimit,
  assetTypeById: ReadonlyMap<string, string>,
): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const exempt = new Set(limit.exemptAssetTypes ?? []);
  // Piso não se aplica a ativo individual: acusaria toda posição pequena.
  const soTeto: RiskLimit = { ...limit, warnBelowPercentage: undefined };

  for (const exposure of exposures) {
    if (limit.scopeKey !== null && exposure.riskBucket !== limit.scopeKey) {
      continue;
    }
    // Tipos isentos não têm teto individual — são monitorados por outros
    // recortes (classe, emissor, duration, vencimento).
    if (exempt.has(assetTypeById.get(exposure.assetId) ?? "")) continue;

    const current = round4((exposure.valueBRL / totalBRL) * 100);
    const trigger = triggerFor(current, soTeto);
    if (trigger === null) continue;

    alerts.push(
      buildAlert(
        "SINGLE_ASSET",
        limit.scopeKey ?? exposure.riskBucket,
        exposure.ticker,
        current,
        exposure.valueBRL,
        totalBRL,
        trigger,
      ),
    );
  }

  return alerts;
}

/**
 * Faixa para a soma de todos os ativos de um mesmo bucket.
 *
 * Diferente dos demais escopos, um bucket AUSENTE da carteira é informação: se
 * a política pede um piso de caixa e não há nenhum ativo em caixa, a exposição
 * é 0% e o alerta precisa disparar. Por isso o bucket alvo é avaliado mesmo
 * quando `groupExposureBy` não produz grupo para ele.
 */
function checkBucketAggregate(
  exposures: readonly AssetExposure[],
  totalBRL: number,
  limit: RiskLimit,
): RiskAlert[] {
  const groups = groupExposureBy<RiskBucket>(exposures, (e) => e.riskBucket);
  const alerts: RiskAlert[] = [];

  const alvos =
    limit.scopeKey === null
      ? groups
      : [
          groups.find((g) => g.key === limit.scopeKey) ?? {
            key: limit.scopeKey as RiskBucket,
            weight: 0,
            valueBRL: 0,
          },
        ];

  for (const group of alvos) {
    const trigger = triggerFor(group.weight, limit);
    if (trigger === null) continue;

    alerts.push(
      buildAlert(
        "RISK_BUCKET",
        group.key,
        `Bucket ${group.key}`,
        group.weight,
        group.valueBRL,
        totalBRL,
        trigger,
      ),
    );
  }

  return alerts;
}

/** Concentração por setor, país ou moeda. */
function checkDimension(
  exposures: readonly AssetExposure[],
  totalBRL: number,
  limit: RiskLimit,
  keyOf: (exposure: AssetExposure) => string,
): RiskAlert[] {
  const groups = groupExposureBy(exposures, keyOf);
  const alerts: RiskAlert[] = [];

  for (const group of groups) {
    if (group.key === "") continue; // dimensão não aplicável a este ativo
    if (limit.scopeKey !== null && group.key !== limit.scopeKey) continue;

    const trigger = triggerFor(group.weight, limit);
    if (trigger === null) continue;

    alerts.push(
      buildAlert(
        limit.scope,
        group.key,
        group.key,
        group.weight,
        group.valueBRL,
        totalBRL,
        trigger,
      ),
    );
  }

  return alerts;
}
