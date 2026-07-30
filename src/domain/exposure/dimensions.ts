/**
 * EXPOSIÇÃO MULTIDIMENSIONAL
 * ===========================
 *
 * O ERRO QUE ESTE MODELO CORRIGE
 * -------------------------------
 * A versão anterior tratava todos os fatores como um único conjunto e RATEAVA
 * o valor do ativo entre eles, para que o total global somasse 100%. Isso é
 * conceitualmente errado: R$ 100 mil em GOOGL não são R$ 50 mil de Equity EUA
 * mais R$ 50 mil de Tecnologia. São R$ 100 mil de Equity EUA **e**,
 * simultaneamente, R$ 100 mil de Tecnologia. A mesma moeda carrega as duas
 * exposições ao mesmo tempo.
 *
 * Ratear subestimava sistematicamente toda concentração.
 *
 * O MODELO CORRETO
 * ----------------
 * As exposições vivem em DIMENSÕES INDEPENDENTES. Cada dimensão é uma partição
 * completa do patrimônio:
 *
 *   - DENTRO de uma dimensão, os pesos somam 100%;
 *   - ENTRE dimensões, não há relação alguma — a soma total é 100% por
 *     dimensão, não 100% no agregado.
 *
 * GOOGL a R$ 100 mil aparece como:
 *
 *   CLASSE       Ações/ETFs Exterior  R$ 100.000   (100% da posição)
 *   GEOGRAFIA    Estados Unidos       R$ 100.000   (100% da posição)
 *   MOEDA        USD                  R$ 100.000   (100% da posição)
 *   SETOR/TEMA   Tecnologia / AI      R$ 100.000   (100% da posição)
 *   ESTILO       Growth               R$ 100.000   (100% da posição)
 *   RISK BUCKET  Core                 R$ 100.000   (100% da posição)
 *   MACRO        Equity EUA           R$ 100.000   (100% da posição)
 *
 * Sete leituras do MESMO dinheiro, cada uma respondendo a uma pergunta
 * diferente. Nenhuma divisão artificial.
 *
 * Note ESTILO=Growth e RISK BUCKET=Core na mesma linha: são dimensões
 * distintas. Estilo descreve o ATIVO (busca crescimento); risk bucket descreve
 * o DIMENSIONAMENTO da posição (estrutural, teto de 5%).
 *
 * Divisão dentro de uma dimensão só acontece quando é economicamente real:
 * um papel indexado ao IPCA carrega juros real e inflação ao mesmo tempo,
 * e não há como separá-lo em dois.
 */

export const EXPOSURE_DIMENSIONS = [
  "CLASSE",
  "GEOGRAFIA",
  "MOEDA",
  "SETOR_TEMA",
  "ESTILO",
  "RISK_BUCKET",
  "MACRO",
] as const;

export type ExposureDimension = (typeof EXPOSURE_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<ExposureDimension, string> = {
  CLASSE: "Classe econômica",
  GEOGRAFIA: "Geografia",
  MOEDA: "Moeda",
  SETOR_TEMA: "Setor / Tema",
  ESTILO: "Estilo de investimento",
  RISK_BUCKET: "Papel na carteira",
  MACRO: "Fatores macro",
};

export const DIMENSION_QUESTIONS: Record<ExposureDimension, string> = {
  CLASSE: "Em que classe de ativo o dinheiro está alocado?",
  GEOGRAFIA: "A que economia esse dinheiro está exposto?",
  MOEDA: "Em que moeda esse dinheiro está denominado?",
  SETOR_TEMA: "A que setor ou tema esse dinheiro está exposto?",
  ESTILO: "Que tipo de retorno esse ativo busca?",
  RISK_BUCKET: "Que papel a posição cumpre e quanto ela pode pesar?",
  MACRO: "A que choque macroeconômico esse dinheiro reage?",
};

// ---------------------------------------------------------------------------
// Catálogo de tags por dimensão
// ---------------------------------------------------------------------------
// CLASSE, MOEDA e RISK_BUCKET derivam de campos que o ativo já tem
// (asset_class, currency, risk_bucket) e reusam os enums de shared/types.

export const GEOGRAPHY_TAGS = [
  "BRASIL",
  "EUA",
  "EUROPA",
  "CHINA",
  "EMERGENTES",
  "GLOBAL",
  "OUTROS",
] as const;

export type GeographyTag = (typeof GEOGRAPHY_TAGS)[number];

export const GEOGRAPHY_LABELS: Record<GeographyTag, string> = {
  BRASIL: "Brasil",
  EUA: "Estados Unidos",
  EUROPA: "Europa",
  CHINA: "China",
  EMERGENTES: "Emergentes",
  GLOBAL: "Global",
  OUTROS: "Outros",
};

export const SECTOR_THEME_TAGS = [
  "TECNOLOGIA_AI",
  "FINANCEIRO",
  "ENERGIA",
  "MATERIAIS",
  "SAUDE",
  "CONSUMO",
  "INDUSTRIAIS",
  "IMOBILIARIO",
  "AGRO",
  "DIVERSIFICADO",
  "NAO_APLICAVEL",
] as const;

export type SectorThemeTag = (typeof SECTOR_THEME_TAGS)[number];

export const SECTOR_THEME_LABELS: Record<SectorThemeTag, string> = {
  TECNOLOGIA_AI: "Tecnologia / AI",
  FINANCEIRO: "Financeiro",
  ENERGIA: "Energia",
  MATERIAIS: "Materiais",
  SAUDE: "Saúde",
  CONSUMO: "Consumo",
  INDUSTRIAIS: "Industriais",
  IMOBILIARIO: "Imobiliário",
  AGRO: "Agronegócio",
  DIVERSIFICADO: "Diversificado (índice amplo)",
  NAO_APLICAVEL: "Não aplicável",
};

/**
 * ESTILO DE INVESTIMENTO — característica do ATIVO.
 *
 * NÃO confundir com `risk_bucket`, que é decisão de DIMENSIONAMENTO da posição
 * (quanto ela pode pesar: CORE 5%, GROWTH 3%, ASYMMETRIC 0,5%).
 *
 * O termo "growth" existe nos dois com sentidos diferentes: aqui significa
 * "ativo que busca crescimento de receita"; em risk_bucket significa "posição
 * que, por ser mais volátil, tem teto de 3%". Um ETF de índice pode ser
 * ESTILO=INDICE e RISK_BUCKET=CORE ao mesmo tempo.
 */
export const STYLE_TAGS = [
  "VALUE",
  "GROWTH",
  "BLEND",
  "QUALIDADE",
  "DIVIDENDOS",
  "INDICE",
  "RENDA",
  "NAO_APLICAVEL",
] as const;

export type StyleTag = (typeof STYLE_TAGS)[number];

export const STYLE_LABELS: Record<StyleTag, string> = {
  VALUE: "Value",
  GROWTH: "Growth",
  BLEND: "Blend",
  QUALIDADE: "Qualidade",
  DIVIDENDOS: "Dividendos",
  INDICE: "Índice / passivo",
  RENDA: "Renda / juros",
  NAO_APLICAVEL: "Não aplicável",
};

/**
 * Fatores macro: a que choque a posição reage.
 *
 * TECNOLOGIA saiu daqui de propósito — ela é um SETOR, não um fator macro.
 * Mantê-la junto de Equity EUA obrigaria a ratear GOOGL entre as duas, que é
 * exatamente o erro que este modelo corrige.
 */
export const MACRO_TAGS = [
  "JUROS_BR",
  "INFLACAO_BR",
  "CREDITO_BR",
  "EQUITY_BR",
  "EQUITY_US",
  "EQUITY_EMERGENTES",
  "COMMODITIES",
  "IMOBILIARIO",
  "DURATION_USD",
  "CAIXA",
  "OUTROS",
] as const;

export type MacroTag = (typeof MACRO_TAGS)[number];

export const MACRO_LABELS: Record<MacroTag, string> = {
  JUROS_BR: "Juros Brasil",
  INFLACAO_BR: "Inflação Brasil",
  CREDITO_BR: "Crédito Brasil",
  EQUITY_BR: "Equity Brasil",
  EQUITY_US: "Equity EUA",
  EQUITY_EMERGENTES: "Equity Emergentes",
  COMMODITIES: "Commodities",
  IMOBILIARIO: "Imobiliário",
  DURATION_USD: "Duration USD",
  CAIXA: "Caixa",
  OUTROS: "Não classificado",
};

/** Peso de uma tag dentro de UMA dimensão. Somam 1 por (ativo, dimensão). */
export interface DimensionWeight {
  readonly tag: string;
  readonly weight: number;
}

/** Uma faixa de exposição dentro de uma dimensão. */
export interface ExposureBucket {
  readonly tag: string;
  readonly label: string;
  readonly valueBRL: number;
  /** Percentual DENTRO da dimensão (as faixas somam 100). */
  readonly percentage: number;
  readonly assetCount: number;
}

/** Uma dimensão completa: partição de 100% do patrimônio. */
export interface DimensionExposure {
  readonly dimension: ExposureDimension;
  readonly label: string;
  readonly question: string;
  readonly buckets: readonly ExposureBucket[];
  /** Base considerada nesta dimensão (normalmente o patrimônio total). */
  readonly totalBRL: number;
}

export function labelFor(dimension: ExposureDimension, tag: string): string {
  switch (dimension) {
    case "GEOGRAFIA":
      return GEOGRAPHY_LABELS[tag as GeographyTag] ?? tag;
    case "SETOR_TEMA":
      return SECTOR_THEME_LABELS[tag as SectorThemeTag] ?? tag;
    case "ESTILO":
      return STYLE_LABELS[tag as StyleTag] ?? tag;
    case "MACRO":
      return MACRO_LABELS[tag as MacroTag] ?? tag;
    default:
      return tag;
  }
}
