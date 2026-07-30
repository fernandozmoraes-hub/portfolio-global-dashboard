import type { AssetClass, Currency, RiskBucket } from "@/domain/shared/types";
import { ASSET_CLASS_LABELS, RISK_BUCKET_LABELS } from "@/domain/shared/types";
import { round6 } from "@/domain/money/types";
import type {
  DimensionWeight,
  ExposureDimension,
  GeographyTag,
  MacroTag,
  SectorThemeTag,
} from "./dimensions";

/**
 * DERIVAÇÃO DAS TAGS POR DIMENSÃO
 * ================================
 *
 * A carteira real chega por importação, sem classificação nenhuma. Exigir
 * classificação manual de dezenas de ativos antes de ver qualquer coisa faria
 * as telas nascerem vazias. Por isso cada dimensão é derivada de atributos que
 * o ativo já possui.
 *
 * Regra central: **os pesos somam 1 DENTRO de cada dimensão**, e cada dimensão
 * é resolvida de forma totalmente independente das outras.
 *
 * Divisão dentro de uma dimensão só ocorre quando é economicamente real —
 * uma debênture incentivada é mesmo parte crédito e parte inflação. Nunca se
 * divide um ativo só para "fechar" a soma entre dimensões diferentes.
 */

export interface AssetTags {
  readonly assetType: string;
  readonly assetClass: AssetClass;
  readonly country: string;
  readonly currency: Currency;
  readonly sector: string | null;
  readonly riskBucket: RiskBucket;
  readonly name: string;
}

function w(tag: string, weight: number): DimensionWeight {
  return { tag, weight };
}

const COMMODITY_SECTORS = new Set(["Energia", "Materiais", "Mineração", "Agro"]);
const TECH_SECTORS = new Set(["Tecnologia", "Technology", "Semicondutores"]);

function isIpcaLinked(name: string): boolean {
  const n = name.toUpperCase();
  return n.includes("IPCA") || n.includes("INCENTIVAD") || n.includes("INFLA");
}

// ---------------------------------------------------------------------------
// CLASSE — 1 ativo, 1 classe. Sempre 100%.
// ---------------------------------------------------------------------------
function deriveClasse(asset: AssetTags): DimensionWeight[] {
  return [w(asset.assetClass, 1)];
}

// ---------------------------------------------------------------------------
// MOEDA — moeda de denominação. Sempre 100%.
// ---------------------------------------------------------------------------
function deriveMoeda(asset: AssetTags): DimensionWeight[] {
  return [w(asset.currency, 1)];
}

// ---------------------------------------------------------------------------
// ESTILO — papel da posição na carteira, vindo do risk bucket.
// ---------------------------------------------------------------------------
function deriveEstilo(asset: AssetTags): DimensionWeight[] {
  return [w(asset.riskBucket, 1)];
}

// ---------------------------------------------------------------------------
// GEOGRAFIA — a que economia a posição está exposta.
// ---------------------------------------------------------------------------
function deriveGeografia(asset: AssetTags): DimensionWeight[] {
  const map: Record<string, GeographyTag> = {
    BR: "BRASIL",
    US: "EUA",
    CN: "CHINA",
    EU: "EUROPA",
    DE: "EUROPA",
    FR: "EUROPA",
    GB: "EUROPA",
    GLOBAL: "GLOBAL",
  };
  return [w(map[asset.country] ?? "OUTROS", 1)];
}

// ---------------------------------------------------------------------------
// SETOR / TEMA — a que setor econômico ou tema a posição está exposta.
// ---------------------------------------------------------------------------
// É AQUI que Tecnologia/AI vive, e não em MACRO. Assim GOOGL conta 100% em
// "Equity EUA" (macro) E 100% em "Tecnologia / AI" (setor), sem rateio.
// ---------------------------------------------------------------------------
function deriveSetorTema(asset: AssetTags): DimensionWeight[] {
  const sector = asset.sector ?? "";

  if (TECH_SECTORS.has(sector)) return [w("TECNOLOGIA_AI", 1)];

  const bySector: Record<string, SectorThemeTag> = {
    Financeiro: "FINANCEIRO",
    Energia: "ENERGIA",
    Materiais: "MATERIAIS",
    Mineração: "MATERIAIS",
    Saúde: "SAUDE",
    Consumo: "CONSUMO",
    Industriais: "INDUSTRIAIS",
    Imobiliário: "IMOBILIARIO",
    Agro: "AGRO",
  };
  const mapped = bySector[sector];
  if (mapped) return [w(mapped, 1)];

  // Sem setor declarado: infere pelo tipo de instrumento.
  switch (asset.assetType) {
    case "FII":
    case "REIT":
    case "CRI":
      return [w("IMOBILIARIO", 1)];
    case "CRA":
      return [w("AGRO", 1)];
    case "ETF":
    case "FUNDO":
      return [w("DIVERSIFICADO", 1)];
    case "CAIXA":
    case "TESOURO_DIRETO":
    case "CDB":
    case "LCI_LCA":
    case "BOND":
      return [w("NAO_APLICAVEL", 1)];
    default:
      return [w("DIVERSIFICADO", 1)];
  }
}

// ---------------------------------------------------------------------------
// MACRO — a que choque macroeconômico a posição reage.
// ---------------------------------------------------------------------------
// Aqui a divisão dentro da dimensão é legítima: uma debênture IPCA+ carrega
// mesmo dois riscos macro distintos no mesmo papel.
// ---------------------------------------------------------------------------
function deriveMacro(asset: AssetTags): DimensionWeight[] {
  const sector = asset.sector ?? "";
  const isBrazil = asset.country === "BR";
  const isCommodity = COMMODITY_SECTORS.has(sector);

  switch (asset.assetType) {
    case "CAIXA":
      return [w("CAIXA", 1)];

    case "TESOURO_DIRETO":
      return isIpcaLinked(asset.name)
        ? [w("INFLACAO_BR", 0.7), w("JUROS_BR", 0.3)]
        : [w("JUROS_BR", 1)];

    case "CDB":
    case "LCI_LCA":
      return [w("JUROS_BR", 0.85), w("CREDITO_BR", 0.15)];

    case "DEBENTURE":
      return isIpcaLinked(asset.name)
        ? [w("CREDITO_BR", 0.55), w("INFLACAO_BR", 0.45)]
        : [w("CREDITO_BR", 0.6), w("JUROS_BR", 0.4)];

    case "CRI":
      return [w("CREDITO_BR", 0.5), w("IMOBILIARIO", 0.3), w("INFLACAO_BR", 0.2)];

    case "CRA":
      return [w("CREDITO_BR", 0.5), w("COMMODITIES", 0.3), w("INFLACAO_BR", 0.2)];

    case "ACAO": {
      const equity: MacroTag = isBrazil ? "EQUITY_BR" : "EQUITY_US";
      // Petrobras e Vale reagem a commodities além do equity local — divisão
      // legítima dentro da dimensão macro.
      return isCommodity ? [w(equity, 0.6), w("COMMODITIES", 0.4)] : [w(equity, 1)];
    }

    case "ETF": {
      if (asset.assetClass === "RF_CAIXA_EXTERIOR") return [w("DURATION_USD", 1)];
      if (asset.country === "US") return [w("EQUITY_US", 1)];
      if (isBrazil) return [w("EQUITY_BR", 1)];
      // Emergentes, Europa e Ásia agora têm fator próprio, em vez de
      // desaparecer num residual.
      return [w("EQUITY_GLOBAL", 1)];
    }

    case "FII":
      return [w("IMOBILIARIO", 1)];

    case "REIT":
      return [w("IMOBILIARIO", 0.7), w("EQUITY_US", 0.3)];

    case "BOND":
      return [w("DURATION_USD", 1)];

    case "FUNDO":
      // Sem transparência da carteira do fundo, é uma convenção declarada.
      // O gestor sobrepõe quando conhecer a composição real.
      return [w("JUROS_BR", 0.5), w("EQUITY_BR", 0.5)];

    default:
      return [w("OUTROS", 1)];
  }
}

const DERIVERS: Record<ExposureDimension, (asset: AssetTags) => DimensionWeight[]> =
  {
    CLASSE: deriveClasse,
    GEOGRAFIA: deriveGeografia,
    MOEDA: deriveMoeda,
    SETOR_TEMA: deriveSetorTema,
    ESTILO: deriveEstilo,
    MACRO: deriveMacro,
  };

/** Tags derivadas de um ativo em UMA dimensão. Os pesos somam 1. */
export function deriveDimension(
  asset: AssetTags,
  dimension: ExposureDimension,
): DimensionWeight[] {
  return DERIVERS[dimension](asset);
}

/** Renormaliza para somar exatamente 1 dentro da dimensão. */
export function normalize(weights: readonly DimensionWeight[]): DimensionWeight[] {
  const total = weights.reduce((acc, item) => acc + item.weight, 0);
  if (total === 0) return [];
  return weights.map((item) => ({
    tag: item.tag,
    weight: round6(item.weight / total),
  }));
}

/**
 * Tags efetivas: sobreposição manual quando existe para AQUELA dimensão,
 * derivação automática caso contrário.
 *
 * A sobreposição é por dimensão: definir MACRO à mão não afeta GEOGRAFIA.
 */
export function resolveDimension(
  asset: AssetTags,
  dimension: ExposureDimension,
  overrides: readonly DimensionWeight[] | undefined,
): DimensionWeight[] {
  if (overrides && overrides.length > 0) return normalize(overrides);
  return deriveDimension(asset, dimension);
}

/** Rótulo legível para tags de CLASSE e ESTILO, que reusam enums existentes. */
export function labelForSharedTag(
  dimension: ExposureDimension,
  tag: string,
): string | null {
  if (dimension === "CLASSE") {
    return ASSET_CLASS_LABELS[tag as AssetClass] ?? null;
  }
  if (dimension === "ESTILO") {
    return RISK_BUCKET_LABELS[tag as RiskBucket] ?? null;
  }
  return null;
}
