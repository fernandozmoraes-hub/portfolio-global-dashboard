/**
 * FATORES DE RISCO
 * =================
 *
 * Classe de ativo responde "onde está o dinheiro".
 * Fator de risco responde "ao que esse dinheiro reage".
 *
 * Um mesmo choque atinge ativos de classes diferentes. Uma alta de juros no
 * Brasil bate simultaneamente em Tesouro prefixado (RF Brasil), em FIIs de
 * papel (Imobiliário) e em ações de consumo (Ações Brasil). A visão por classe
 * não mostra isso; a visão por fator, sim.
 */

export const RISK_FACTORS = [
  "JUROS_BR",
  "INFLACAO_BR",
  "CREDITO_BR",
  "EQUITY_BR",
  "EQUITY_US",
  "TECH_AI",
  "COMMODITIES",
  "IMOBILIARIO",
  "DURATION_USD",
  "OUTROS",
] as const;

export type RiskFactor = (typeof RISK_FACTORS)[number];

export const RISK_FACTOR_LABELS: Record<RiskFactor, string> = {
  JUROS_BR: "Juros Brasil",
  INFLACAO_BR: "Inflação Brasil",
  CREDITO_BR: "Crédito Brasil",
  EQUITY_BR: "Equity Brasil",
  EQUITY_US: "Equity EUA",
  TECH_AI: "Tecnologia / AI",
  COMMODITIES: "Commodities",
  IMOBILIARIO: "Imobiliário",
  DURATION_USD: "Duration USD",
  OUTROS: "Outros / não classificado",
};

export const RISK_FACTOR_DESCRIPTIONS: Record<RiskFactor, string> = {
  JUROS_BR:
    "Sensibilidade à curva de juros brasileira (pré e pós-fixado, Selic/DI).",
  INFLACAO_BR: "Indexação ao IPCA e proteção contra inflação brasileira.",
  CREDITO_BR:
    "Risco de crédito corporativo brasileiro (debêntures, CRIs, CRAs).",
  EQUITY_BR: "Renda variável brasileira.",
  EQUITY_US: "Renda variável norte-americana.",
  TECH_AI:
    "Concentração em tecnologia e inteligência artificial, dentro ou fora do país.",
  COMMODITIES: "Petróleo, mineração, agronegócio e materiais básicos.",
  IMOBILIARIO: "Imóveis, FIIs, REITs e crédito com lastro imobiliário.",
  DURATION_USD: "Sensibilidade à curva de juros em dólar.",
  OUTROS:
    "Não classificado pela derivação automática. Requer classificação manual.",
};

/** Peso de um fator dentro de um ativo. Os pesos de um ativo somam 1. */
export interface FactorWeight {
  readonly factor: RiskFactor;
  /** 0 a 1. */
  readonly weight: number;
}

/** Exposição consolidada da carteira a um fator. */
export interface FactorExposure {
  readonly factor: RiskFactor;
  readonly label: string;
  readonly valueBRL: number;
  /** Peso do fator na carteira global (0-100). */
  readonly percentage: number;
  /** Quantos ativos distintos contribuem para este fator. */
  readonly assetCount: number;
}
