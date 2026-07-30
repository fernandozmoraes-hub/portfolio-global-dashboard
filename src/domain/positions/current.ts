import type { PositionInput } from "@/domain/consolidation/consolidate";
import { rateToBRL, type FxTable } from "@/domain/money/convert";
import { round2 } from "@/domain/money/types";

/**
 * POSIÇÃO CORRENTE vs NAV DE FECHAMENTO
 * ======================================
 *
 * São duas coisas diferentes, e confundi-las produz números errados.
 *
 * POSIÇÃO CORRENTE ("o que eu tenho agora")
 * -----------------------------------------
 * Cada corretora fecha e exporta em datas diferentes: a XP pode estar
 * atualizada em 31/07 e a Avenue só em 28/07. Usar uma data global — o
 * `max(reference_date)` de toda a base — descartaria silenciosamente as contas
 * que não têm posição naquele dia exato, subestimando o patrimônio.
 *
 * A regra correta é: para CADA CONTA, a data mais recente que ela possui.
 * O resultado é uma carteira montada de fontes com datas potencialmente
 * distintas — e por isso a defasagem de cada fonte precisa ser EXIBIDA, não
 * escondida.
 *
 * NAV DE FECHAMENTO ("quanto valia em 31/07")
 * -------------------------------------------
 * Aqui o requisito é o oposto: consistência temporal. Todas as quantidades são
 * reprecificadas para UMA data de referência e UM câmbio. Ver `reprice.ts`.
 */

/**
 * Modo de importação — define o que o arquivo REPRESENTA.
 *
 *   FULL_ACCOUNT_SNAPSHOT  retrato completo da conta naquela data. O que não
 *                          está no arquivo, não existe mais na conta.
 *   PARTIAL_UPDATE         atualização de alguns ativos. O que não está no
 *                          arquivo continua valendo do snapshot anterior.
 *
 * Sem essa distinção, um screenshot de um único fundo apagaria os outros seis
 * da conta — foi exatamente o que aconteceu no primeiro preview da carteira
 * real, descartando R$ 34 mil em multimercados.
 */
export type ImportMode = "FULL_ACCOUNT_SNAPSHOT" | "PARTIAL_UPDATE";

/** Posição com a data em que foi apurada e o modo do import que a trouxe. */
export interface DatedPosition extends PositionInput {
  readonly referenceDate: string;
  /** Ausente = tratado como snapshot completo (padrão conservador). */
  readonly importMode?: ImportMode;
}

/** Estado de atualização de uma fonte (conta de uma corretora). */
export interface SourceFreshness {
  readonly accountId: string;
  readonly accountName: string;
  readonly brokerId: string;
  readonly brokerName: string;
  /** Data da posição mais recente desta conta. */
  readonly referenceDate: string;
  /** Dias entre essa data e a referência da consulta. */
  readonly ageDays: number;
  /** Acima do limite tolerado — a UI deve destacar. */
  readonly isStale: boolean;
  /** Limiar aplicado a esta fonte, em dias. */
  readonly staleThresholdDays: number;
  readonly positionCount: number;
  readonly valueBRL: number;
}

export interface CurrentPortfolio {
  /** Posições correntes, uma por (conta, ativo), cada conta na sua data. */
  readonly positions: readonly PositionInput[];
  /** Estado de atualização por fonte, ordenado da mais antiga para a mais nova. */
  readonly sources: readonly SourceFreshness[];
  /** Data mais antiga entre as fontes. */
  readonly oldestDate: string | null;
  /** Data mais recente entre as fontes. */
  readonly newestDate: string | null;
  /** True quando as fontes não estão todas na mesma data. */
  readonly hasMixedDates: boolean;
  /** True quando ao menos uma fonte está defasada. */
  readonly hasStaleSources: boolean;
}

/**
 * Limiares de defasagem POR TIPO DE FONTE.
 *
 * Um preço de ação de 30 dias atrás é obsoleto; a cota de um fundo que divulga
 * mensalmente, não. Um limiar único trataria os dois como iguais.
 */
export interface StaleThresholds {
  /** Padrão, quando nenhuma regra específica se aplica. */
  readonly default: number;
  /** Por tipo de ativo predominante na conta. */
  readonly byAssetType?: Readonly<Record<string, number>>;
  /** Por conta, quando o gestor conhece a cadência daquela fonte. */
  readonly byAccountId?: Readonly<Record<string, number>>;
}

export const DEFAULT_STALE_THRESHOLDS: StaleThresholds = {
  default: 5,
  byAssetType: {
    // Cotação diária: qualquer coisa acima de uma semana já é velha.
    ACAO: 5,
    ETF: 5,
    FII: 5,
    REIT: 5,
    // Marcação diária, mas tolera atraso operacional.
    TESOURO_DIRETO: 10,
    BOND: 10,
    CDB: 20,
    LCI_LCA: 20,
    DEBENTURE: 20,
    CRI: 20,
    CRA: 20,
    // Cota de fundo costuma sair com defasagem.
    FUNDO: 35,
    CAIXA: 35,
  },
};

/** Compatibilidade: limiar único legado. */
export const DEFAULT_STALE_DAYS = 35;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Monta a carteira corrente pegando, para cada conta, sua data mais recente.
 *
 * @param positions todas as posições conhecidas, com data
 * @param asOf      data de referência para calcular a defasagem (hoje)
 * @param fx        câmbio para valorar as fontes
 * @param staleDays limite de defasagem tolerada
 */
export function resolveCurrentPortfolio(
  positions: readonly DatedPosition[],
  asOf: string,
  fx: FxTable,
  thresholds: StaleThresholds | number = DEFAULT_STALE_THRESHOLDS,
  assetTypeById: ReadonlyMap<string, string> = new Map(),
): CurrentPortfolio {
  const limits: StaleThresholds =
    typeof thresholds === "number" ? { default: thresholds } : thresholds;
  if (positions.length === 0) {
    return {
      positions: [],
      sources: [],
      oldestDate: null,
      newestDate: null,
      hasMixedDates: false,
      hasStaleSources: false,
    };
  }

  // Último SNAPSHOT COMPLETO de cada conta — a base sobre a qual as
  // atualizações parciais são sobrepostas.
  const baseDateByAccount = new Map<string, string>();
  for (const position of positions) {
    if ((position.importMode ?? "FULL_ACCOUNT_SNAPSHOT") !== "FULL_ACCOUNT_SNAPSHOT") {
      continue;
    }
    const current = baseDateByAccount.get(position.accountId);
    if (current === undefined || position.referenceDate > current) {
      baseDateByAccount.set(position.accountId, position.referenceDate);
    }
  }

  // Uma posição por (conta, ativo): a base do snapshot completo, depois
  // sobreposta pela atualização parcial mais recente daquele ativo.
  const chosen = new Map<string, DatedPosition>();

  for (const position of positions) {
    const key = `${position.accountId}::${position.assetId}`;
    const mode = position.importMode ?? "FULL_ACCOUNT_SNAPSHOT";
    const baseDate = baseDateByAccount.get(position.accountId);

    if (mode === "FULL_ACCOUNT_SNAPSHOT") {
      // Só entra se for do último snapshot completo da conta.
      if (position.referenceDate !== baseDate) continue;
    } else {
      // Parcial anterior ao snapshot completo já foi absorvida por ele.
      if (baseDate !== undefined && position.referenceDate <= baseDate) continue;
    }

    const previous = chosen.get(key);
    if (previous === undefined || position.referenceDate > previous.referenceDate) {
      chosen.set(key, position);
    }
  }

  const selected: PositionInput[] = [];
  const byAccount = new Map<string, { rows: DatedPosition[] }>();

  for (const position of chosen.values()) {
    const { referenceDate: _d, importMode: _m, ...rest } = position;
    void _d;
    void _m;
    selected.push(rest);

    const bucket = byAccount.get(position.accountId);
    if (bucket) bucket.rows.push(position);
    else byAccount.set(position.accountId, { rows: [position] });
  }

  const sources: SourceFreshness[] = [];

  for (const [accountId, { rows }] of byAccount) {
    const head = rows[0];
    if (!head) continue;

    const valueBRL = rows.reduce((acc, row) => {
      const rate = rateToBRL(row.currency, fx);
      return acc + row.quantity * row.currentPrice * rate;
    }, 0);

    // A data exibida é a mais ANTIGA da conta: é ela que limita a
    // confiabilidade do conjunto, mesmo que um ativo tenha sido atualizado.
    const datas = rows.map((r) => r.referenceDate).sort();
    const oldestOfAccount = datas[0]!;
    const ageDays = daysBetween(oldestOfAccount, asOf);

    // Limiar: da conta, senão do tipo de ativo predominante, senão o padrão.
    const tipos = rows.map((r) => assetTypeById.get(r.assetId) ?? "");
    const predominante = tipos
      .filter(Boolean)
      .sort(
        (a, b) =>
          tipos.filter((t) => t === b).length - tipos.filter((t) => t === a).length,
      )[0];

    const threshold =
      limits.byAccountId?.[accountId] ??
      (predominante ? limits.byAssetType?.[predominante] : undefined) ??
      limits.default;

    sources.push({
      accountId,
      accountName: head.accountName,
      brokerId: head.brokerId,
      brokerName: head.brokerName,
      referenceDate: oldestOfAccount,
      ageDays,
      isStale: ageDays > threshold,
      staleThresholdDays: threshold,
      positionCount: rows.length,
      valueBRL: round2(valueBRL),
    });
  }

  sources.sort((a, b) => a.referenceDate.localeCompare(b.referenceDate));

  const dates = [...new Set(sources.map((s) => s.referenceDate))].sort();

  return {
    positions: selected,
    sources,
    oldestDate: dates[0] ?? null,
    newestDate: dates[dates.length - 1] ?? null,
    hasMixedDates: dates.length > 1,
    hasStaleSources: sources.some((s) => s.isStale),
  };
}
