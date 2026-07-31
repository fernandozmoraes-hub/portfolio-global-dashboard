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
  /** Teto em % da carteira global (0-100). Acima disso é VIOLAÇÃO. */
  readonly maxPercentage: number;
  /**
   * Início da faixa de atenção, em %.
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
   * Tipos de ativo aos quais o limite NÃO se aplica.
   *
   * Existe para o caso do Tesouro: um teto de 5% por ativo faz sentido para
   * ação, não para título soberano — concentrar em NTN-B não é o mesmo risco
   * que concentrar numa empresa. A exposição soberana é monitorada por classe,
   * emissor, duration e vencimento, não por teto individual.
   */
  readonly exemptAssetTypes?: readonly string[];
}

export interface RiskAlert {
  readonly scope: RiskLimitScope;
  readonly scopeKey: string;
  /** Identificação legível do que violou. */
  readonly subject: string;
  readonly currentPercentage: number;
  readonly maxPercentage: number;
  /** Início da faixa de atenção efetivamente aplicada. */
  readonly warnPercentage: number;
  /** Excesso em pontos percentuais. */
  readonly excessPercentagePoints: number;
  /** Quanto reduzir em R$ para voltar ao limite. */
  readonly excessBRL: number;
  readonly severity: PolicySeverity;
}

/** Fração do limite a partir da qual o alerta fica amarelo, se não houver warn. */
const ATTENTION_THRESHOLD = 0.9;

function severityFor(
  current: number,
  max: number,
  warn?: number,
): PolicySeverity | null {
  if (max <= 0) return current > 0 ? "VIOLACAO" : null;
  if (current > max) return "VIOLACAO";
  const threshold = warn ?? max * ATTENTION_THRESHOLD;
  if (current >= threshold) return "ATENCAO";
  return null;
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

  for (const exposure of exposures) {
    if (limit.scopeKey !== null && exposure.riskBucket !== limit.scopeKey) {
      continue;
    }
    // Tipos isentos não têm teto individual — são monitorados por outros
    // recortes (classe, emissor, duration, vencimento).
    if (exempt.has(assetTypeById.get(exposure.assetId) ?? "")) continue;

    const current = round4((exposure.valueBRL / totalBRL) * 100);
    const severity = severityFor(current, limit.maxPercentage, limit.warnPercentage);
    if (severity === null) continue;

    alerts.push({
      scope: "SINGLE_ASSET",
      scopeKey: limit.scopeKey ?? exposure.riskBucket,
      subject: exposure.ticker,
      currentPercentage: current,
      maxPercentage: limit.maxPercentage,
      warnPercentage: limit.warnPercentage ?? round4(limit.maxPercentage * ATTENTION_THRESHOLD),
      excessPercentagePoints: round4(current - limit.maxPercentage),
      excessBRL: round2(
        exposure.valueBRL - (totalBRL * limit.maxPercentage) / 100,
      ),
      severity,
    });
  }

  return alerts;
}

/** Teto para a soma de todos os ativos de um mesmo bucket. */
function checkBucketAggregate(
  exposures: readonly AssetExposure[],
  totalBRL: number,
  limit: RiskLimit,
): RiskAlert[] {
  const groups = groupExposureBy<RiskBucket>(exposures, (e) => e.riskBucket);
  const alerts: RiskAlert[] = [];

  for (const group of groups) {
    if (limit.scopeKey !== null && group.key !== limit.scopeKey) continue;

    const severity = severityFor(group.weight, limit.maxPercentage, limit.warnPercentage);
    if (severity === null) continue;

    alerts.push({
      scope: "RISK_BUCKET",
      scopeKey: group.key,
      subject: `Bucket ${group.key}`,
      currentPercentage: group.weight,
      maxPercentage: limit.maxPercentage,
      warnPercentage: limit.warnPercentage ?? round4(limit.maxPercentage * ATTENTION_THRESHOLD),
      excessPercentagePoints: round4(group.weight - limit.maxPercentage),
      excessBRL: round2(group.valueBRL - (totalBRL * limit.maxPercentage) / 100),
      severity,
    });
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

    const severity = severityFor(group.weight, limit.maxPercentage, limit.warnPercentage);
    if (severity === null) continue;

    alerts.push({
      scope: limit.scope,
      scopeKey: group.key,
      subject: group.key,
      currentPercentage: group.weight,
      maxPercentage: limit.maxPercentage,
      warnPercentage: limit.warnPercentage ?? round4(limit.maxPercentage * ATTENTION_THRESHOLD),
      excessPercentagePoints: round4(group.weight - limit.maxPercentage),
      excessBRL: round2(group.valueBRL - (totalBRL * limit.maxPercentage) / 100),
      severity,
    });
  }

  return alerts;
}
