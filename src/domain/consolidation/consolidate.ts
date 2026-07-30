import type { AssetClass, Currency, RiskBucket } from "@/domain/shared/types";
import { rateToBRL, type FxTable } from "@/domain/money/convert";
import { round2, round4 } from "@/domain/money/types";

/**
 * CUSTÓDIA vs EXPOSIÇÃO ECONÔMICA
 * ================================
 *
 * Uma posição é sempre (conta, ativo): é onde o papel está custodiado.
 * A exposição é a soma de todas as custódias do mesmo ativo.
 *
 * Este módulo é a fronteira entre os dois conceitos. Toda regra de risco e de
 * peso opera sobre `AssetExposure`, NUNCA sobre `PositionInput` — caso
 * contrário GOOGL a 3% na Avenue + 3% em outra corretora passaria despercebido
 * por um limite de 5%.
 */

/** Uma posição como custodiada em uma conta específica. */
export interface PositionInput {
  readonly accountId: string;
  readonly accountName: string;
  readonly brokerId: string;
  readonly brokerName: string;
  readonly assetId: string;
  readonly ticker: string;
  readonly assetName: string;
  readonly assetClass: AssetClass;
  readonly riskBucket: RiskBucket;
  readonly currency: Currency;
  readonly country: string;
  readonly sector: string | null;
  readonly quantity: number;
  /** Custo médio por unidade, na moeda do ativo. */
  readonly averageCost: number | null;
  /** Preço unitário corrente, na moeda do ativo. */
  readonly currentPrice: number;
}

/** Onde uma parcela da exposição está custodiada. */
export interface CustodyBreakdown {
  readonly accountId: string;
  readonly accountName: string;
  readonly brokerId: string;
  readonly brokerName: string;
  readonly quantity: number;
  readonly valueOriginal: number;
  readonly valueBRL: number;
  /** Participação desta custódia dentro da exposição do ativo (0-100). */
  readonly shareOfAsset: number;
}

/** Exposição econômica consolidada a um ativo, somando todas as corretoras. */
export interface AssetExposure {
  readonly assetId: string;
  readonly ticker: string;
  readonly assetName: string;
  readonly assetClass: AssetClass;
  readonly riskBucket: RiskBucket;
  readonly currency: Currency;
  readonly country: string;
  readonly sector: string | null;
  readonly quantity: number;
  /** Custo médio ponderado por quantidade, na moeda do ativo. */
  readonly averageCost: number | null;
  readonly currentPrice: number;
  readonly valueOriginal: number;
  readonly valueBRL: number;
  /** Custo total investido em BRL (à taxa de câmbio corrente). */
  readonly costBRL: number | null;
  /** Resultado não realizado em BRL. */
  readonly unrealizedResultBRL: number | null;
  /** Resultado não realizado em %. */
  readonly unrealizedResultPercent: number | null;
  /** Em quantas corretoras distintas o ativo está custodiado. */
  readonly custodyCount: number;
  readonly custodies: readonly CustodyBreakdown[];
}

/**
 * Consolida posições por ativo, somando entre corretoras.
 *
 * O custo médio consolidado é ponderado pela quantidade — não é a média
 * aritmética dos custos médios de cada corretora. Posições sem custo informado
 * tornam o custo consolidado `null` (não é zero: é desconhecido).
 */
export function consolidatePositions(
  positions: readonly PositionInput[],
  fx: FxTable,
): AssetExposure[] {
  const byAsset = new Map<string, PositionInput[]>();

  for (const position of positions) {
    const bucket = byAsset.get(position.assetId);
    if (bucket) {
      bucket.push(position);
    } else {
      byAsset.set(position.assetId, [position]);
    }
  }

  const exposures: AssetExposure[] = [];

  for (const group of byAsset.values()) {
    const head = group[0];
    if (head === undefined) continue;

    const fxRate = rateToBRL(head.currency, fx);

    let totalQuantity = 0;
    let totalValueOriginal = 0;
    let weightedCostSum = 0;
    let hasUnknownCost = false;

    for (const position of group) {
      totalQuantity += position.quantity;
      totalValueOriginal += position.quantity * position.currentPrice;

      if (position.averageCost === null) {
        hasUnknownCost = true;
      } else {
        weightedCostSum += position.quantity * position.averageCost;
      }
    }

    const averageCost =
      hasUnknownCost || totalQuantity === 0
        ? null
        : round4(weightedCostSum / totalQuantity);

    const valueOriginal = round2(totalValueOriginal);
    const valueBRL = round2(totalValueOriginal * fxRate);
    const costBRL =
      averageCost === null ? null : round2(averageCost * totalQuantity * fxRate);
    const unrealizedResultBRL =
      costBRL === null ? null : round2(valueBRL - costBRL);
    const unrealizedResultPercent =
      costBRL === null || costBRL === 0
        ? null
        : round4(((valueBRL - costBRL) / costBRL) * 100);

    const custodies: CustodyBreakdown[] = group.map((position) => {
      const custodyValueOriginal = position.quantity * position.currentPrice;
      return {
        accountId: position.accountId,
        accountName: position.accountName,
        brokerId: position.brokerId,
        brokerName: position.brokerName,
        quantity: position.quantity,
        valueOriginal: round2(custodyValueOriginal),
        valueBRL: round2(custodyValueOriginal * fxRate),
        shareOfAsset:
          totalValueOriginal === 0
            ? 0
            : round4((custodyValueOriginal / totalValueOriginal) * 100),
      };
    });

    const distinctBrokers = new Set(group.map((p) => p.brokerId));

    exposures.push({
      assetId: head.assetId,
      ticker: head.ticker,
      assetName: head.assetName,
      assetClass: head.assetClass,
      riskBucket: head.riskBucket,
      currency: head.currency,
      country: head.country,
      sector: head.sector,
      quantity: round4(totalQuantity),
      averageCost,
      currentPrice: head.currentPrice,
      valueOriginal,
      valueBRL,
      costBRL,
      unrealizedResultBRL,
      unrealizedResultPercent,
      custodyCount: distinctBrokers.size,
      custodies,
    });
  }

  return exposures.sort((a, b) => b.valueBRL - a.valueBRL);
}

/** Patrimônio financeiro total em BRL. Não inclui imóvel. */
export function totalFinancialValueBRL(
  exposures: readonly AssetExposure[],
): number {
  return round2(exposures.reduce((acc, e) => acc + e.valueBRL, 0));
}

/** Peso de cada ativo na carteira global (0-100). */
export function assetWeights(
  exposures: readonly AssetExposure[],
): Map<string, number> {
  const total = totalFinancialValueBRL(exposures);
  const weights = new Map<string, number>();
  if (total === 0) {
    for (const exposure of exposures) weights.set(exposure.assetId, 0);
    return weights;
  }
  for (const exposure of exposures) {
    weights.set(exposure.assetId, round4((exposure.valueBRL / total) * 100));
  }
  return weights;
}

/** Agrupa a exposição por uma dimensão qualquer (país, setor, moeda, bucket). */
export function groupExposureBy<K extends string>(
  exposures: readonly AssetExposure[],
  keyOf: (exposure: AssetExposure) => K,
): { key: K; valueBRL: number; weight: number }[] {
  const total = totalFinancialValueBRL(exposures);
  const totals = new Map<K, number>();

  for (const exposure of exposures) {
    const key = keyOf(exposure);
    totals.set(key, (totals.get(key) ?? 0) + exposure.valueBRL);
  }

  return [...totals.entries()]
    .map(([key, valueBRL]) => ({
      key,
      valueBRL: round2(valueBRL),
      weight: total === 0 ? 0 : round4((valueBRL / total) * 100),
    }))
    .sort((a, b) => b.valueBRL - a.valueBRL);
}
