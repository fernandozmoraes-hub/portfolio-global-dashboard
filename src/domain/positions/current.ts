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

/** Posição com a data em que foi apurada. */
export interface DatedPosition extends PositionInput {
  readonly referenceDate: string;
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

/** Dias de defasagem a partir dos quais uma fonte é considerada desatualizada. */
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
  staleDays: number = DEFAULT_STALE_DAYS,
): CurrentPortfolio {
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

  // Data mais recente de CADA conta — não uma data global.
  const latestByAccount = new Map<string, string>();
  for (const position of positions) {
    const current = latestByAccount.get(position.accountId);
    if (current === undefined || position.referenceDate > current) {
      latestByAccount.set(position.accountId, position.referenceDate);
    }
  }

  const selected: PositionInput[] = [];
  const byAccount = new Map<string, { rows: DatedPosition[] }>();

  for (const position of positions) {
    if (position.referenceDate !== latestByAccount.get(position.accountId)) {
      continue; // posição histórica desta conta
    }

    const { referenceDate: _ignored, ...rest } = position;
    void _ignored;
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

    const ageDays = daysBetween(head.referenceDate, asOf);

    sources.push({
      accountId,
      accountName: head.accountName,
      brokerId: head.brokerId,
      brokerName: head.brokerName,
      referenceDate: head.referenceDate,
      ageDays,
      isStale: ageDays > staleDays,
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
