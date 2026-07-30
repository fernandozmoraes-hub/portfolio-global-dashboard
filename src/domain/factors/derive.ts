import type { AssetClass, Currency, RiskBucket } from "@/domain/shared/types";
import { round6 } from "@/domain/money/types";
import type { FactorWeight, RiskFactor } from "./types";

/**
 * DERIVAÇÃO AUTOMÁTICA DE FATORES
 * ================================
 *
 * A carteira real chega por importação, sem nenhuma classificação de fator.
 * Exigir que o gestor classifique 60 ativos à mão antes de ver qualquer coisa
 * seria inaceitável — a tela nasceria vazia.
 *
 * Por isso os fatores são DERIVADOS de atributos que o ativo já tem
 * (tipo, classe, setor, país). O gestor sobrepõe apenas o que discordar, via
 * `asset_risk_factors`.
 *
 * As regras abaixo são heurísticas explícitas e auditáveis, não um modelo
 * estatístico. Elas representam uma leitura razoável e conservadora — e podem
 * ser revistas a qualquer momento sem tocar em código, pela sobreposição.
 */

export interface FactorDerivationInput {
  readonly assetType: string;
  readonly assetClass: AssetClass;
  readonly country: string;
  readonly currency: Currency;
  readonly sector: string | null;
  readonly riskBucket: RiskBucket;
  readonly name: string;
}

function w(factor: RiskFactor, weight: number): FactorWeight {
  return { factor, weight };
}

/** Setores tratados como proxy de commodities. */
const COMMODITY_SECTORS = new Set(["Energia", "Materiais", "Mineração", "Agro"]);
const TECH_SECTORS = new Set(["Tecnologia", "Technology", "Semicondutores"]);

function isIpcaLinked(name: string): boolean {
  const normalized = name.toUpperCase();
  return (
    normalized.includes("IPCA") ||
    normalized.includes("INCENTIVAD") ||
    normalized.includes("INFLA")
  );
}

/**
 * Deriva os fatores de risco de um ativo.
 *
 * Retorna sempre pesos que somam 1 (ou vazio, para caixa — que não carrega
 * fator de risco algum e por isso é excluído da base de cálculo).
 */
export function deriveFactorWeights(
  asset: FactorDerivationInput,
): FactorWeight[] {
  const sector = asset.sector ?? "";
  const isBrazil = asset.country === "BR";
  const isTech = TECH_SECTORS.has(sector);
  const isCommodity = COMMODITY_SECTORS.has(sector);

  switch (asset.assetType) {
    // ---- Caixa: sem exposição a fator de risco ----
    case "CAIXA":
      return [];

    // ---- Renda fixa soberana brasileira ----
    case "TESOURO_DIRETO":
      return isIpcaLinked(asset.name)
        ? [w("INFLACAO_BR", 0.7), w("JUROS_BR", 0.3)]
        : [w("JUROS_BR", 1)];

    // ---- Renda fixa bancária ----
    case "CDB":
    case "LCI_LCA":
      return [w("JUROS_BR", 0.85), w("CREDITO_BR", 0.15)];

    // ---- Crédito corporativo ----
    case "DEBENTURE": {
      const base: FactorWeight[] = isIpcaLinked(asset.name)
        ? [w("CREDITO_BR", 0.55), w("INFLACAO_BR", 0.45)]
        : [w("CREDITO_BR", 0.6), w("JUROS_BR", 0.4)];
      // Debênture de empresa de energia carrega commodity indiretamente
      return isCommodity ? reweight([...base, w("COMMODITIES", 0.2)]) : base;
    }

    case "CRI":
      return [w("CREDITO_BR", 0.45), w("IMOBILIARIO", 0.35), w("INFLACAO_BR", 0.2)];

    case "CRA":
      return [w("CREDITO_BR", 0.45), w("COMMODITIES", 0.35), w("INFLACAO_BR", 0.2)];

    // ---- Renda variável ----
    case "ACAO": {
      const equity: RiskFactor = isBrazil ? "EQUITY_BR" : "EQUITY_US";
      if (isTech) return [w(equity, 0.5), w("TECH_AI", 0.5)];
      if (isCommodity) return [w(equity, 0.6), w("COMMODITIES", 0.4)];
      if (sector === "Imobiliário") return [w(equity, 0.6), w("IMOBILIARIO", 0.4)];
      return [w(equity, 1)];
    }

    case "ETF": {
      // Um ETF de renda fixa internacional é duration em dólar, não equity.
      if (asset.assetClass === "RF_CAIXA_EXTERIOR") return [w("DURATION_USD", 1)];
      if (asset.country === "US") {
        return isTech ? [w("EQUITY_US", 0.5), w("TECH_AI", 0.5)] : [w("EQUITY_US", 1)];
      }
      if (isBrazil) return [w("EQUITY_BR", 1)];
      // Equity fora de BR/US (mercados emergentes, Europa, Ásia) não tem fator
      // próprio na lista inicial. Vai para OUTROS de forma VISÍVEL, sinalizando
      // que precisa de classificação manual ou de um fator novo.
      return [w("OUTROS", 1)];
    }

    case "FII":
      return [w("IMOBILIARIO", 1)];

    case "REIT":
      return [w("IMOBILIARIO", 0.7), w("EQUITY_US", 0.3)];

    // ---- Renda fixa internacional ----
    case "BOND":
      return [w("DURATION_USD", 1)];

    // ---- Multimercado: multi-fator por natureza ----
    case "FUNDO":
      // Sem transparência da carteira do fundo, a repartição é uma convenção
      // declarada. O gestor deve sobrepor quando conhecer a composição real.
      return [w("JUROS_BR", 0.5), w("EQUITY_BR", 0.5)];

    default:
      return [w("OUTROS", 1)];
  }
}

/** Renormaliza pesos para somarem exatamente 1. */
function reweight(weights: FactorWeight[]): FactorWeight[] {
  const total = weights.reduce((acc, item) => acc + item.weight, 0);
  if (total === 0) return weights;
  return weights.map((item) => ({
    factor: item.factor,
    weight: round6(item.weight / total),
  }));
}

/**
 * Resolve os fatores efetivos de um ativo: sobreposição manual quando existe,
 * derivação automática caso contrário.
 */
export function resolveFactorWeights(
  asset: FactorDerivationInput,
  overrides: readonly FactorWeight[] | undefined,
): FactorWeight[] {
  if (overrides && overrides.length > 0) {
    return reweight([...overrides]);
  }
  return deriveFactorWeights(asset);
}
