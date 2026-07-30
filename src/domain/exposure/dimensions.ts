/**
 * EXPOSIÇÃO MULTIDIMENSIONAL
 * ===========================
 *
 * DOIS TIPOS DE DIMENSÃO
 * ----------------------
 * O erro corrigido na versão anterior era ratear entre fatores para fechar
 * 100%. A correção agora vai um nível mais fundo: **nem toda dimensão é uma
 * partição**.
 *
 *   PARTIÇÃO (soma 100%)
 *     O ativo pertence a exatamente UM balde. Classe, geografia, moeda,
 *     emissor, setor, estilo e risk bucket são assim: um Tesouro IPCA+ está
 *     em RF Brasil, é brasileiro, é BRL, é soberano. Não há ambiguidade.
 *
 *   SOBREPOSIÇÃO (pode somar mais de 100%)
 *     O ativo carrega N exposições SIMULTÂNEAS, cada uma pelo valor INTEIRO.
 *     Fatores macro e temas são assim.
 *
 * POR QUE FATORES NÃO SÃO PARTIÇÃO
 * --------------------------------
 * Um Tesouro IPCA+ de R$ 100 mil não é "70% inflação + 30% juros". Ele é:
 *
 *     R$ 100.000 expostos à inflação IPCA        (100% do papel)
 *     R$ 100.000 expostos a juros reais          (100% do papel)
 *     R$ 100.000 expostos a duration             (100% do papel)
 *
 * Se o IPCA subir, os R$ 100 mil inteiros reagem. Se o juro real subir, os
 * R$ 100 mil inteiros reagem. Ratear em 70/30 diria que só R$ 70 mil sofrem
 * com inflação — falso, e subestima o risco.
 *
 * Um CRI IPCA+ carrega, cada um por inteiro: crédito, inflação, duration e
 * imobiliário. Quatro exposições de 100% sobre o mesmo papel.
 *
 * Consequência: numa dimensão de sobreposição, a soma dos percentuais
 * ULTRAPASSA 100%, e isso é correto. O total exibido é o do patrimônio, e
 * cada barra mede quanto do patrimônio reage àquele fator.
 */

export const EXPOSURE_DIMENSIONS = [
  "CLASSE",
  "GEOGRAFIA",
  "MOEDA",
  "EMISSOR",
  "SETOR",
  "ESTILO",
  "RISK_BUCKET",
  "TEMA",
  "MACRO",
] as const;

export type ExposureDimension = (typeof EXPOSURE_DIMENSIONS)[number];

/** Partição soma 100%; sobreposição pode ultrapassar. */
export type DimensionKind = "PARTICAO" | "SOBREPOSICAO";

export const DIMENSION_KIND: Record<ExposureDimension, DimensionKind> = {
  CLASSE: "PARTICAO",
  GEOGRAFIA: "PARTICAO",
  MOEDA: "PARTICAO",
  EMISSOR: "PARTICAO",
  SETOR: "PARTICAO",
  ESTILO: "PARTICAO",
  RISK_BUCKET: "PARTICAO",
  TEMA: "SOBREPOSICAO",
  MACRO: "SOBREPOSICAO",
};

export const DIMENSION_LABELS: Record<ExposureDimension, string> = {
  CLASSE: "Classe econômica",
  GEOGRAFIA: "Geografia",
  MOEDA: "Moeda",
  EMISSOR: "Emissor",
  SETOR: "Setor",
  ESTILO: "Estilo de investimento",
  RISK_BUCKET: "Papel na carteira",
  TEMA: "Temas",
  MACRO: "Fatores macro",
};

export const DIMENSION_QUESTIONS: Record<ExposureDimension, string> = {
  CLASSE: "Em que classe de ativo o dinheiro está alocado?",
  GEOGRAFIA: "A que economia esse dinheiro está exposto?",
  MOEDA: "Em que moeda esse dinheiro está denominado?",
  EMISSOR: "Quem é o devedor ou emissor do papel?",
  SETOR: "Em que setor econômico o emissor atua?",
  ESTILO: "Que tipo de retorno esse ativo busca?",
  RISK_BUCKET: "Que papel a posição cumpre e quanto ela pode pesar?",
  TEMA: "A que teses ou temas essa posição está exposta?",
  MACRO: "A que choques macroeconômicos esse dinheiro reage?",
};

// ---------------------------------------------------------------------------
// EMISSOR — separado de setor
// ---------------------------------------------------------------------------
// "Governo Federal" é EMISSOR soberano, não setor econômico. Tratá-lo como
// setor fazia o Tesouro disparar o limite de concentração setorial, que existe
// para medir outra coisa (exposição a um ramo da economia).
// ---------------------------------------------------------------------------
export const ISSUER_TAGS = [
  "SOBERANO_BR",
  "SOBERANO_US",
  "BANCARIO_BR",
  "CORPORATIVO_BR",
  "SECURITIZADORA_BR",
  "CORPORATIVO_US",
  "CORPORATIVO_GLOBAL",
  "FUNDO_BR",
  "FII_BR",
  "REIT_US",
  "CAIXA",
  "NAO_CLASSIFICADO",
] as const;

export type IssuerTag = (typeof ISSUER_TAGS)[number];

export const ISSUER_LABELS: Record<IssuerTag, string> = {
  SOBERANO_BR: "Soberano Brasil (Tesouro Nacional)",
  SOBERANO_US: "Soberano EUA (Treasury)",
  BANCARIO_BR: "Bancário Brasil",
  CORPORATIVO_BR: "Corporativo Brasil",
  SECURITIZADORA_BR: "Securitizadora Brasil (CRI/CRA)",
  CORPORATIVO_US: "Corporativo EUA",
  CORPORATIVO_GLOBAL: "Corporativo global",
  FUNDO_BR: "Fundo de investimento BR",
  FII_BR: "FII brasileiro",
  REIT_US: "REIT norte-americano",
  CAIXA: "Caixa",
  NAO_CLASSIFICADO: "Não classificado",
};

// ---------------------------------------------------------------------------
// SETOR canônico — partição
// ---------------------------------------------------------------------------
export const SECTOR_TAGS = [
  "TECNOLOGIA",
  "FINANCEIRO",
  "ENERGIA",
  "MATERIAIS",
  "SAUDE",
  "CONSUMO",
  "INDUSTRIAIS",
  "IMOBILIARIO",
  "UTILITIES",
  "COMUNICACAO",
  "TELECOM",
  "CONSTRUCAO",
  "AGRO",
  "DIVERSIFICADO",
  "NAO_APLICAVEL",
] as const;

export type SectorTag = (typeof SECTOR_TAGS)[number];

export const SECTOR_LABELS: Record<SectorTag, string> = {
  TECNOLOGIA: "Tecnologia",
  FINANCEIRO: "Financeiro",
  ENERGIA: "Energia",
  MATERIAIS: "Materiais",
  SAUDE: "Saúde",
  CONSUMO: "Consumo",
  INDUSTRIAIS: "Industriais",
  IMOBILIARIO: "Imobiliário",
  UTILITIES: "Utilities",
  COMUNICACAO: "Comunicação",
  TELECOM: "Telecomunicações",
  CONSTRUCAO: "Construção civil",
  AGRO: "Agronegócio",
  DIVERSIFICADO: "Diversificado (índice amplo)",
  NAO_APLICAVEL: "Não aplicável",
};

// ---------------------------------------------------------------------------
// TEMA — sobreposição
// ---------------------------------------------------------------------------
// Um ativo pode carregar vários temas ao mesmo tempo, cada um pelo valor
// inteiro. SOXX é simultaneamente 100% Tecnologia/AI e 100% Semicondutores.
// ---------------------------------------------------------------------------
export const THEME_TAGS = [
  "TECNOLOGIA_AI",
  "SEMICONDUTORES",
  "NUCLEAR_URANIO",
  "BIOTECH",
  "DIVIDENDOS",
  "CHINA",
  "DEFESA",
  "LOGISTICA",
  "SHOPPINGS",
  "ESCRITORIOS",
  "SANEAMENTO",
  "CREDITO_IMOBILIARIO",
] as const;

export type ThemeTag = (typeof THEME_TAGS)[number];

export const THEME_LABELS: Record<ThemeTag, string> = {
  TECNOLOGIA_AI: "Tecnologia / AI",
  SEMICONDUTORES: "Semicondutores",
  NUCLEAR_URANIO: "Nuclear / Urânio",
  BIOTECH: "Biotecnologia",
  DIVIDENDOS: "Dividendos",
  CHINA: "China",
  DEFESA: "Defesa",
  LOGISTICA: "Logística",
  SHOPPINGS: "Shoppings",
  ESCRITORIOS: "Escritórios",
  SANEAMENTO: "Saneamento",
  CREDITO_IMOBILIARIO: "Crédito imobiliário",
};

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

export const GEOGRAPHY_TAGS = [
  "BRASIL", "EUA", "EUROPA", "CHINA", "EMERGENTES", "GLOBAL", "OUTROS",
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

// ---------------------------------------------------------------------------
// MACRO — sobreposição
// ---------------------------------------------------------------------------
// Cada tag mede quanto do patrimônio REAGE àquele choque, pelo valor inteiro.
// A soma da dimensão ultrapassa 100% e isso é correto: um mesmo real pode
// reagir a inflação, a juro real e a duration ao mesmo tempo.
// ---------------------------------------------------------------------------
export const MACRO_TAGS = [
  "INFLACAO_IPCA",
  "JUROS_REAL_BR",
  "JUROS_NOMINAL_BR",
  "DURATION_BR",
  "CREDITO_BR",
  "EQUITY_BR",
  "EQUITY_US",
  "EQUITY_EMERGENTES",
  "COMMODITIES",
  "IMOBILIARIO",
  "DURATION_USD",
  "CREDITO_US",
  "CAIXA",
  "NAO_CLASSIFICADO",
] as const;

export type MacroTag = (typeof MACRO_TAGS)[number];

export const MACRO_LABELS: Record<MacroTag, string> = {
  INFLACAO_IPCA: "Inflação IPCA",
  JUROS_REAL_BR: "Juros real Brasil",
  JUROS_NOMINAL_BR: "Juros nominal Brasil (CDI/Selic/pré)",
  DURATION_BR: "Duration Brasil",
  CREDITO_BR: "Crédito Brasil",
  EQUITY_BR: "Equity Brasil",
  EQUITY_US: "Equity EUA",
  EQUITY_EMERGENTES: "Equity Emergentes",
  COMMODITIES: "Commodities",
  IMOBILIARIO: "Imobiliário",
  DURATION_USD: "Duration USD",
  CREDITO_US: "Crédito EUA",
  CAIXA: "Caixa",
  NAO_CLASSIFICADO: "Não classificado",
};

/**
 * Peso de uma tag.
 *
 * Em dimensão de PARTIÇÃO, os pesos de um ativo somam 1.
 * Em dimensão de SOBREPOSIÇÃO, cada tag vale 1 (o valor inteiro do ativo).
 */
export interface DimensionWeight {
  readonly tag: string;
  readonly weight: number;
}

export interface ExposureBucket {
  readonly tag: string;
  readonly label: string;
  readonly valueBRL: number;
  /** Percentual sobre o patrimônio total da dimensão. */
  readonly percentage: number;
  readonly assetCount: number;
}

export interface DimensionExposure {
  readonly dimension: ExposureDimension;
  readonly kind: DimensionKind;
  readonly label: string;
  readonly question: string;
  readonly buckets: readonly ExposureBucket[];
  readonly totalBRL: number;
  /** Soma dos percentuais. 100 em partição; pode exceder em sobreposição. */
  readonly percentageSum: number;
}

export function labelFor(dimension: ExposureDimension, tag: string): string {
  switch (dimension) {
    case "GEOGRAFIA":
      return GEOGRAPHY_LABELS[tag as GeographyTag] ?? tag;
    case "EMISSOR":
      return ISSUER_LABELS[tag as IssuerTag] ?? tag;
    case "SETOR":
      return SECTOR_LABELS[tag as SectorTag] ?? tag;
    case "TEMA":
      return THEME_LABELS[tag as ThemeTag] ?? tag;
    case "ESTILO":
      return STYLE_LABELS[tag as StyleTag] ?? tag;
    case "MACRO":
      return MACRO_LABELS[tag as MacroTag] ?? tag;
    default:
      return tag;
  }
}
