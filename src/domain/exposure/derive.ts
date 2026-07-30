import type { AssetClass, Currency, RiskBucket } from "@/domain/shared/types";
import { ASSET_CLASS_LABELS, RISK_BUCKET_LABELS } from "@/domain/shared/types";
import { round6 } from "@/domain/money/types";
import {
  DIMENSION_KIND,
  type DimensionWeight,
  type ExposureDimension,
  type GeographyTag,
  type IssuerTag,
  type MacroTag,
  type SectorTag,
  type ThemeTag,
} from "./dimensions";

/**
 * DERIVAÇÃO DAS TAGS POR DIMENSÃO
 * ================================
 *
 * Duas regras distintas, conforme o tipo da dimensão:
 *
 *   PARTIÇÃO       os pesos do ativo somam 1 (um balde só, ou divisão real)
 *   SOBREPOSIÇÃO   cada tag recebe peso 1 — o valor INTEIRO do ativo
 *
 * Um Tesouro IPCA+ em MACRO devolve três tags de peso 1: inflação, juro real
 * e duration. Não é 70/30: o papel inteiro reage a cada um desses choques.
 */

export type RateIndex =
  | "IPCA" | "IGPM" | "CDI" | "SELIC" | "PREFIXADO" | "USD_FIXED" | "NONE";

/** Natureza do FII. Espelha o ENUM fii_type (migration 0014). */
export type FiiType = "TIJOLO" | "PAPEL" | "HIBRIDO" | "FOF" | "NAO_APLICAVEL";

const INFLATION_LINKED: ReadonlySet<RateIndex> = new Set(["IPCA", "IGPM"]);
const NOMINAL_LINKED: ReadonlySet<RateIndex> = new Set([
  "CDI", "SELIC", "PREFIXADO",
]);

export interface AssetTags {
  readonly assetType: string;
  readonly assetClass: AssetClass;
  readonly country: string;
  readonly currency: Currency;
  /** Setor como veio da fonte, preservado sem normalização. */
  readonly rawSector: string | null;
  readonly riskBucket: RiskBucket;
  readonly investmentStyle: string;
  readonly indexador: RateIndex;
  /** Natureza do FII. Para não-FII, NAO_APLICAVEL. */
  readonly fiiType: FiiType;
  /** Vencimento, quando conhecido. Nunca deduzido de ticker ou nome. */
  readonly maturityDate: string | null;
  readonly name: string;
}

/** Tag de peso 1 — usado tanto para partição de balde único quanto para sobreposição. */
function w(tag: string, weight = 1): DimensionWeight {
  return { tag, weight };
}

// ---------------------------------------------------------------------------
// Normalização de setor
// ---------------------------------------------------------------------------
// As fontes trazem "Tecnologia / Internet", "Financeiro / Bancos". O texto
// bruto é PRESERVADO em rawSector; aqui produz-se a forma canônica.
// A parte antes da barra é a categoria; a de depois vira TEMA.
// ---------------------------------------------------------------------------
const SECTOR_CANON: Record<string, SectorTag> = {
  tecnologia: "TECNOLOGIA",
  technology: "TECNOLOGIA",
  financeiro: "FINANCEIRO",
  energia: "ENERGIA",
  materiais: "MATERIAIS",
  mineracao: "MATERIAIS",
  saude: "SAUDE",
  consumo: "CONSUMO",
  industriais: "INDUSTRIAIS",
  imobiliario: "IMOBILIARIO",
  utilities: "UTILITIES",
  comunicacao: "COMUNICACAO",
  telecomunicacoes: "TELECOM",
  telecom: "TELECOM",
  "construcao civil": "CONSTRUCAO",
  construcao: "CONSTRUCAO",
  agro: "AGRO",
  agronegocio: "AGRO",
  acoes: "DIVERSIFICADO",
  "renda fixa": "NAO_APLICAVEL",
  "renda variavel brasil": "DIVERSIFICADO",
  multimercado: "DIVERSIFICADO",
  "governo federal": "NAO_APLICAVEL", // é EMISSOR, não setor
  caixa: "NAO_APLICAVEL",
  israel: "DIVERSIFICADO",
  china: "DIVERSIFICADO",
};

/** Remove acentos e baixa a caixa, para casar com o dicionário. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** Parte antes da barra: a categoria de setor. */
export function rawSectorHead(rawSector: string | null): string {
  if (!rawSector) return "";
  return normalize(rawSector.split("/")[0] ?? "");
}

/** Parte depois da barra: a especialização, que vira tema. */
export function rawSectorTail(rawSector: string | null): string {
  if (!rawSector) return "";
  const parts = rawSector.split("/");
  return parts.length > 1 ? normalize(parts.slice(1).join("/")) : "";
}

// ---------------------------------------------------------------------------
// PARTIÇÕES
// ---------------------------------------------------------------------------

function deriveClasse(a: AssetTags): DimensionWeight[] {
  return [w(a.assetClass)];
}

function deriveMoeda(a: AssetTags): DimensionWeight[] {
  return [w(a.currency)];
}

function deriveEstilo(a: AssetTags): DimensionWeight[] {
  if (a.investmentStyle && a.investmentStyle !== "NAO_APLICAVEL") {
    return [w(a.investmentStyle)];
  }
  switch (a.assetType) {
    case "ETF": return [w("INDICE")];
    case "FII":
    case "REIT": return [w("DIVIDENDOS")];
    case "TESOURO_DIRETO":
    case "CDB":
    case "LCI_LCA":
    case "DEBENTURE":
    case "CRI":
    case "CRA":
    case "BOND": return [w("RENDA")];
    case "ACAO": return [w("BLEND")];
    default: return [w("NAO_APLICAVEL")];
  }
}

function deriveRiskBucket(a: AssetTags): DimensionWeight[] {
  return [w(a.riskBucket)];
}

function deriveGeografia(a: AssetTags): DimensionWeight[] {
  const map: Record<string, GeographyTag> = {
    BR: "BRASIL", US: "EUA", CN: "CHINA", EU: "EUROPA",
    DE: "EUROPA", FR: "EUROPA", GB: "EUROPA", CH: "EUROPA",
    IL: "OUTROS", AR: "EMERGENTES", GLOBAL: "GLOBAL",
  };
  return [w(map[a.country] ?? "OUTROS")];
}

/**
 * EMISSOR — quem deve o dinheiro.
 *
 * Separado de setor porque "Governo Federal" é emissor soberano, não um ramo
 * da economia. Confundir os dois fazia o Tesouro disparar o limite de
 * concentração setorial, que mede outra coisa.
 */
function deriveEmissor(a: AssetTags): DimensionWeight[] {
  const isBR = a.country === "BR";

  switch (a.assetType) {
    case "TESOURO_DIRETO":
      return [w("SOBERANO_BR")];
    case "CDB":
    case "LCI_LCA":
      return [w("BANCARIO_BR")];
    case "DEBENTURE":
      return [w("CORPORATIVO_BR")];
    case "CRI":
    case "CRA":
      return [w("SECURITIZADORA_BR")];
    case "FII":
      return [w("FII_BR")];
    case "REIT":
      return [w("REIT_US")];
    case "FUNDO":
      return [w("FUNDO_BR")];
    case "CAIXA":
      return [w("CAIXA")];
    case "BOND":
      return [w(a.country === "US" ? "CORPORATIVO_US" : "CORPORATIVO_GLOBAL")];
    case "ACAO":
      if (isBR) return [w("CORPORATIVO_BR")];
      return [w(a.country === "US" ? "CORPORATIVO_US" : "CORPORATIVO_GLOBAL")];
    case "ETF":
      // ETF de Treasury é exposição soberana americana, não corporativa.
      if (a.assetClass === "RF_CAIXA_EXTERIOR") return [w("SOBERANO_US")];
      return [w("CORPORATIVO_GLOBAL")];
    default:
      return [w("NAO_CLASSIFICADO")];
  }
}

function deriveSetor(a: AssetTags): DimensionWeight[] {
  const head = rawSectorHead(a.rawSector);
  const canon = SECTOR_CANON[head];
  if (canon) return [w(canon)];

  switch (a.assetType) {
    case "FII":
    case "REIT":
    case "CRI":
      return [w("IMOBILIARIO")];
    case "CRA":
      return [w("AGRO")];
    case "ETF":
    case "FUNDO":
      return [w("DIVERSIFICADO")];
    case "TESOURO_DIRETO":
    case "CDB":
    case "LCI_LCA":
    case "BOND":
    case "CAIXA":
      return [w("NAO_APLICAVEL")];
    default:
      return [w("DIVERSIFICADO")];
  }
}

// ---------------------------------------------------------------------------
// SOBREPOSIÇÕES — cada tag pelo valor INTEIRO
// ---------------------------------------------------------------------------

const THEME_KEYWORDS: ReadonlyArray<readonly [RegExp, ThemeTag]> = [
  [/semicondutor|semiconductor/, "SEMICONDUTORES"],
  [/nuclear|uranio|uranium/, "NUCLEAR_URANIO"],
  [/biotec|biotech/, "BIOTECH"],
  [/dividendo|dividend/, "DIVIDENDOS"],
  [/china/, "CHINA"],
  [/defesa|defense/, "DEFESA"],
  [/logistic/, "LOGISTICA"],
  [/shopping|malls/, "SHOPPINGS"],
  [/escritorio|office/, "ESCRITORIOS"],
  [/saneamento/, "SANEAMENTO"],
  [/credito imobiliario|recebiveis imobiliarios/, "CREDITO_IMOBILIARIO"],
  [/internet|software|tecnologia|technology|inovacao|ai\b/, "TECNOLOGIA_AI"],
];

/**
 * TEMAS — sobrepostos.
 * Um ETF de semicondutores é 100% Tecnologia/AI E 100% Semicondutores.
 */
function deriveTema(a: AssetTags): DimensionWeight[] {
  const texto = normalize(`${a.rawSector ?? ""} ${a.name}`);
  const tags = new Set<ThemeTag>();

  for (const [pattern, tag] of THEME_KEYWORDS) {
    if (pattern.test(texto)) tags.add(tag);
  }

  // Semicondutor implica tecnologia, mesmo sem a palavra aparecer.
  if (tags.has("SEMICONDUTORES")) tags.add("TECNOLOGIA_AI");

  return [...tags].map((tag) => w(tag));
}

/**
 * FATORES MACRO — sobrepostos, cada um pelo valor INTEIRO do ativo.
 *
 * Um Tesouro IPCA+ de R$ 100 mil contribui R$ 100 mil para inflação,
 * R$ 100 mil para juro real e R$ 100 mil para duration. Não é rateio.
 */
function deriveMacro(a: AssetTags): DimensionWeight[] {
  const tags = new Set<MacroTag>();
  const isBR = a.country === "BR";
  const head = rawSectorHead(a.rawSector);
  const isCommodity = ["energia", "materiais", "mineracao", "agro"].includes(head);

  const addRendaFixaBR = () => {
    if (INFLATION_LINKED.has(a.indexador)) {
      tags.add("INFLACAO_IPCA");
      tags.add("JUROS_REAL_BR");
      tags.add("DURATION_BR");
    }
    if (NOMINAL_LINKED.has(a.indexador)) {
      tags.add("JUROS_NOMINAL_BR");
      if (a.indexador === "PREFIXADO") tags.add("DURATION_BR");
    }
    if (a.indexador === "NONE") tags.add("NAO_CLASSIFICADO");
  };

  switch (a.assetType) {
    case "CAIXA":
      tags.add("CAIXA");
      break;

    case "TESOURO_DIRETO":
      addRendaFixaBR();
      break;

    case "CDB":
    case "LCI_LCA":
      addRendaFixaBR();
      tags.add("CREDITO_BR");
      break;

    case "DEBENTURE":
      addRendaFixaBR();
      tags.add("CREDITO_BR");
      if (isCommodity) tags.add("COMMODITIES");
      break;

    case "CRI":
      addRendaFixaBR();
      tags.add("CREDITO_BR");
      tags.add("IMOBILIARIO");
      break;

    case "CRA":
      addRendaFixaBR();
      tags.add("CREDITO_BR");
      tags.add("COMMODITIES");
      break;

    case "ACAO":
      tags.add(isBR ? "EQUITY_BR" : a.country === "US" ? "EQUITY_US" : "EQUITY_EMERGENTES");
      if (isCommodity) tags.add("COMMODITIES");
      if (head === "imobiliario") tags.add("IMOBILIARIO");
      break;

    case "ETF":
      if (a.assetClass === "RF_CAIXA_EXTERIOR") {
        tags.add("DURATION_USD");
      } else if (a.country === "US") {
        tags.add("EQUITY_US");
      } else if (isBR) {
        tags.add("EQUITY_BR");
      } else {
        tags.add("EQUITY_EMERGENTES");
      }
      break;

    case "FII":
      tags.add("IMOBILIARIO");
      // FII de papel é, estruturalmente, uma carteira de CRIs: carrega crédito.
      // Já a exposição a IPCA/CDI depende da COMPOSIÇÃO da carteira do fundo e
      // só pode vir do look-through datado e ponderado. Transformar aqui o
      // indexador predominante em 100% do NAV seria inventar um número, então
      // essa parcela fica declaradamente pendente.
      if (a.fiiType === "PAPEL" || a.fiiType === "HIBRIDO") {
        tags.add("CREDITO_BR");
      }
      break;

    case "REIT":
      tags.add("IMOBILIARIO");
      tags.add("EQUITY_US");
      break;

    case "BOND":
      tags.add("DURATION_USD");
      tags.add(a.country === "US" ? "CREDITO_US" : "CREDITO_BR");
      break;

    case "FUNDO":
      // Sem transparência da carteira, fica explicitamente não classificado —
      // melhor do que inventar uma repartição.
      tags.add("NAO_CLASSIFICADO");
      break;

    default:
      tags.add("NAO_CLASSIFICADO");
  }

  return [...tags].map((tag) => w(tag));
}

const DERIVERS: Record<ExposureDimension, (a: AssetTags) => DimensionWeight[]> = {
  CLASSE: deriveClasse,
  GEOGRAFIA: deriveGeografia,
  MOEDA: deriveMoeda,
  EMISSOR: deriveEmissor,
  SETOR: deriveSetor,
  ESTILO: deriveEstilo,
  RISK_BUCKET: deriveRiskBucket,
  TEMA: deriveTema,
  MACRO: deriveMacro,
};

export function deriveDimension(
  asset: AssetTags,
  dimension: ExposureDimension,
): DimensionWeight[] {
  return DERIVERS[dimension](asset);
}

/**
 * Normaliza conforme o tipo da dimensão.
 * Partição: força soma 1. Sobreposição: cada tag mantém peso 1.
 */
export function normalizeFor(
  dimension: ExposureDimension,
  weights: readonly DimensionWeight[],
): DimensionWeight[] {
  if (DIMENSION_KIND[dimension] === "SOBREPOSICAO") {
    return weights.map((item) => ({ tag: item.tag, weight: 1 }));
  }
  const total = weights.reduce((acc, item) => acc + item.weight, 0);
  if (total === 0) return [];
  return weights.map((item) => ({
    tag: item.tag,
    weight: round6(item.weight / total),
  }));
}

export function resolveDimension(
  asset: AssetTags,
  dimension: ExposureDimension,
  overrides: readonly DimensionWeight[] | undefined,
): DimensionWeight[] {
  if (overrides && overrides.length > 0) return normalizeFor(dimension, overrides);
  return normalizeFor(dimension, deriveDimension(asset, dimension));
}

export function labelForSharedTag(
  dimension: ExposureDimension,
  tag: string,
): string | null {
  if (dimension === "CLASSE") return ASSET_CLASS_LABELS[tag as AssetClass] ?? null;
  if (dimension === "RISK_BUCKET") return RISK_BUCKET_LABELS[tag as RiskBucket] ?? null;
  return null;
}

export type { IssuerTag, SectorTag, ThemeTag };
