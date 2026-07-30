import { round2, round4 } from "@/domain/money/types";
import type { AssetExposure } from "@/domain/consolidation/consolidate";
import { totalFinancialValueBRL } from "@/domain/consolidation/consolidate";
import { resolveFactorWeights, type FactorDerivationInput } from "./derive";
import {
  RISK_FACTORS,
  RISK_FACTOR_LABELS,
  type FactorExposure,
  type FactorWeight,
  type RiskFactor,
} from "./types";

/**
 * Calcula a exposição da carteira por fator de risco.
 *
 * Opera sobre a EXPOSIÇÃO CONSOLIDADA — nunca sobre posições por corretora.
 * Corretora é custódia; fator de risco é uma propriedade econômica do ativo, e
 * somar GOOGL da Avenue com GOOGL da IBKR antes de fatorar é o único jeito de
 * enxergar a concentração real em tecnologia.
 *
 * O valor de cada ativo é RATEADO entre seus fatores conforme os pesos. Um
 * ativo de R$ 100 mil com 50% em EQUITY_US e 50% em TECH_AI contribui R$ 50 mil
 * para cada fator. Por isso a soma das exposições fatoriais é igual ao
 * patrimônio (descontado o caixa, que não carrega fator).
 */
export function computeFactorExposure(
  exposures: readonly AssetExposure[],
  overridesByAsset: ReadonlyMap<string, readonly FactorWeight[]> = new Map(),
  assetTypeById: ReadonlyMap<string, string> = new Map(),
): FactorExposure[] {
  const totalBRL = totalFinancialValueBRL(exposures);
  if (totalBRL === 0) return [];

  const valueByFactor = new Map<RiskFactor, number>();
  const assetsByFactor = new Map<RiskFactor, Set<string>>();

  for (const exposure of exposures) {
    const input: FactorDerivationInput = {
      // O tipo do instrumento nem sempre acompanha a exposição consolidada;
      // quando ausente, a classe econômica é um proxy suficiente.
      assetType: assetTypeById.get(exposure.assetId) ?? fallbackType(exposure),
      assetClass: exposure.assetClass,
      country: exposure.country,
      currency: exposure.currency,
      sector: exposure.sector,
      riskBucket: exposure.riskBucket,
      name: exposure.assetName,
    };

    const weights = resolveFactorWeights(
      input,
      overridesByAsset.get(exposure.assetId),
    );

    for (const { factor, weight } of weights) {
      valueByFactor.set(
        factor,
        (valueByFactor.get(factor) ?? 0) + exposure.valueBRL * weight,
      );

      let bucket = assetsByFactor.get(factor);
      if (!bucket) {
        bucket = new Set();
        assetsByFactor.set(factor, bucket);
      }
      bucket.add(exposure.assetId);
    }
  }

  // O denominador exclui o caixa, que não carrega fator. Assim os percentuais
  // somam 100% do capital EXPOSTO a risco, que é a leitura correta.
  const exposedBRL = [...valueByFactor.values()].reduce((a, b) => a + b, 0);
  if (exposedBRL === 0) return [];

  const order = new Map(RISK_FACTORS.map((f, i) => [f, i]));

  return [...valueByFactor.entries()]
    .map(([factor, valueBRL]) => ({
      factor,
      label: RISK_FACTOR_LABELS[factor],
      valueBRL: round2(valueBRL),
      percentage: round4((valueBRL / exposedBRL) * 100),
      assetCount: assetsByFactor.get(factor)?.size ?? 0,
    }))
    .sort((a, b) => {
      if (b.valueBRL !== a.valueBRL) return b.valueBRL - a.valueBRL;
      return (order.get(a.factor) ?? 99) - (order.get(b.factor) ?? 99);
    });
}

/**
 * Proxy de tipo quando o instrumento não é conhecido: usa a classe econômica.
 * Mantém a derivação funcionando mesmo com dados parciais de importação.
 */
function fallbackType(exposure: AssetExposure): string {
  switch (exposure.assetClass) {
    case "RF_BRASIL":
      return "CDB";
    case "ACOES_BRASIL":
    case "ACOES_ETF_EXTERIOR":
      return "ACAO";
    case "RF_CAIXA_EXTERIOR":
      return "BOND";
    case "FII_IMOBILIARIO":
      return "FII";
    case "MULTIMERCADO_ALTERNATIVO":
      return "FUNDO";
    case "CAIXA_BR":
      return "CAIXA";
    default:
      return "OUTROS";
  }
}

/** Quanto do patrimônio a derivação automática não conseguiu classificar. */
export function unclassifiedShare(
  factorExposures: readonly FactorExposure[],
): number {
  return factorExposures.find((f) => f.factor === "OUTROS")?.percentage ?? 0;
}
