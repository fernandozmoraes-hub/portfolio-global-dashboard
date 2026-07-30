import type { Currency } from "@/domain/shared/types";
import { rateToBRL, type FxTable } from "@/domain/money/convert";
import { round2 } from "@/domain/money/types";

/**
 * NAV DE FECHAMENTO — REPRECIFICAÇÃO TEMPORALMENTE CONSISTENTE
 * ============================================================
 *
 * Enquanto a carteira corrente aceita fontes com datas diferentes (é o que se
 * tem hoje), o FECHAMENTO MENSAL não pode: um NAV em que a XP está avaliada em
 * 31/07 e a Avenue em 28/07, com câmbios diferentes, não é comparável com o do
 * mês anterior — e a rentabilidade calculada em cima dele seria ficção.
 *
 * Por isso o fechamento:
 *
 *   1. toma as QUANTIDADES de cada conta na última posição conhecida
 *      ATÉ a data de referência (a quantidade não muda por si só);
 *   2. reprecifica TODAS elas com preços de UMA ÚNICA data de referência;
 *   3. converte tudo com UM ÚNICO câmbio, o da mesma data.
 *
 * O que não tiver preço na data não é silenciosamente zerado nem estimado:
 * volta em `missingPrices` para o gestor resolver antes de confirmar o
 * fechamento.
 */

export interface QuantityToPrice {
  readonly accountId: string;
  readonly accountName: string;
  readonly brokerName: string;
  readonly assetId: string;
  readonly ticker: string;
  readonly currency: Currency;
  readonly quantity: number;
  /** Data da posição de onde a quantidade veio. */
  readonly quantityAsOf: string;
}

export interface RepricedLine {
  readonly accountId: string;
  readonly assetId: string;
  readonly ticker: string;
  readonly currency: Currency;
  readonly quantity: number;
  readonly quantityAsOf: string;
  /** Preço usado, sempre da data de referência do fechamento. */
  readonly price: number;
  readonly valueOriginal: number;
  readonly fxRateToBRL: number;
  readonly valueBRL: number;
  /** True quando a quantidade veio de data anterior à referência. */
  readonly quantityIsCarriedForward: boolean;
}

export interface MissingPrice {
  readonly assetId: string;
  readonly ticker: string;
  readonly currency: Currency;
}

export interface NavResult {
  readonly referenceDate: string;
  readonly lines: readonly RepricedLine[];
  readonly totalBRL: number;
  /** Ativos sem preço na data — impedem o fechamento. */
  readonly missingPrices: readonly MissingPrice[];
  /** True quando o NAV pode ser confirmado. */
  readonly isComplete: boolean;
  /** Câmbios efetivamente aplicados, congelados no snapshot. */
  readonly fxUsed: Readonly<Record<string, number>>;
}

/**
 * Reprecifica quantidades para uma única data e um único câmbio.
 *
 * @param quantities  quantidades por (conta, ativo), com a data de origem
 * @param priceByAsset preços na data de referência, por assetId
 * @param fx          câmbio ÚNICO da data de referência
 * @param referenceDate data do fechamento
 */
export function buildNav(
  quantities: readonly QuantityToPrice[],
  priceByAsset: ReadonlyMap<string, number>,
  fx: FxTable,
  referenceDate: string,
): NavResult {
  const lines: RepricedLine[] = [];
  const missing = new Map<string, MissingPrice>();
  const fxUsed: Record<string, number> = {};

  for (const item of quantities) {
    const price = priceByAsset.get(item.assetId);

    if (price === undefined) {
      // Sem preço na data: registra e segue, para o gestor ver TODOS os
      // pendentes de uma vez em vez de um por execução.
      missing.set(item.assetId, {
        assetId: item.assetId,
        ticker: item.ticker,
        currency: item.currency,
      });
      continue;
    }

    const fxRate = rateToBRL(item.currency, fx);
    fxUsed[item.currency] = fxRate;

    const valueOriginal = item.quantity * price;

    lines.push({
      accountId: item.accountId,
      assetId: item.assetId,
      ticker: item.ticker,
      currency: item.currency,
      quantity: item.quantity,
      quantityAsOf: item.quantityAsOf,
      price,
      valueOriginal: round2(valueOriginal),
      fxRateToBRL: fxRate,
      valueBRL: round2(valueOriginal * fxRate),
      quantityIsCarriedForward: item.quantityAsOf !== referenceDate,
    });
  }

  const missingPrices = [...missing.values()];

  return {
    referenceDate,
    lines,
    totalBRL: round2(lines.reduce((acc, line) => acc + line.valueBRL, 0)),
    missingPrices,
    // Um NAV incompleto não pode virar fechamento: faltaria patrimônio.
    isComplete: missingPrices.length === 0 && lines.length > 0,
    fxUsed,
  };
}

/**
 * Seleciona, para cada conta, a última posição conhecida ATÉ a data de
 * referência — de onde saem as quantidades a reprecificar.
 *
 * Diferente da carteira corrente, aqui o corte é sempre `<= referenceDate`:
 * um fechamento de julho não pode usar quantidade de agosto.
 */
export function selectQuantitiesAsOf<
  T extends { accountId: string; assetId: string; referenceDate: string },
>(positions: readonly T[], referenceDate: string): T[] {
  const latestByAccount = new Map<string, string>();

  for (const position of positions) {
    if (position.referenceDate > referenceDate) continue;
    const current = latestByAccount.get(position.accountId);
    if (current === undefined || position.referenceDate > current) {
      latestByAccount.set(position.accountId, position.referenceDate);
    }
  }

  return positions.filter(
    (position) =>
      position.referenceDate <= referenceDate &&
      position.referenceDate === latestByAccount.get(position.accountId),
  );
}
