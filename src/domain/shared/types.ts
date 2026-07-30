/**
 * Vocabulário compartilhado do domínio.
 *
 * Estes literais espelham exatamente os ENUMs do PostgreSQL (migration 0001).
 * Qualquer alteração aqui exige migration correspondente.
 */

/** Classes econômicas da política de investimentos. */
export const ASSET_CLASSES = [
  "RF_BRASIL",
  "ACOES_BRASIL",
  "ACOES_ETF_EXTERIOR",
  "RF_CAIXA_EXTERIOR",
  "FII_IMOBILIARIO",
  "MULTIMERCADO_ALTERNATIVO",
  "CAIXA_BR",
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Rótulos em pt-BR para exibição. A UI nunca deve montar estes textos. */
export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  RF_BRASIL: "Renda Fixa Brasil",
  ACOES_BRASIL: "Ações Brasil",
  ACOES_ETF_EXTERIOR: "Ações/ETFs Exterior",
  RF_CAIXA_EXTERIOR: "Renda Fixa / Caixa Exterior",
  FII_IMOBILIARIO: "FIIs / Imobiliário",
  MULTIMERCADO_ALTERNATIVO: "Multimercados / Alternativos",
  CAIXA_BR: "Caixa BR",
};

/** Baldes de risco. Determinam o peso máximo individual de cada ativo. */
export const RISK_BUCKETS = [
  "CORE",
  "GROWTH",
  "SATELLITE",
  "ASYMMETRIC",
  "DEFENSIVE",
  "CASH",
] as const;

export type RiskBucket = (typeof RISK_BUCKETS)[number];

export const RISK_BUCKET_LABELS: Record<RiskBucket, string> = {
  CORE: "Core",
  GROWTH: "Growth",
  SATELLITE: "Satélite",
  ASYMMETRIC: "Assimétrica",
  DEFENSIVE: "Defensiva",
  CASH: "Caixa",
};

/** Moedas suportadas no MVP. */
export const CURRENCIES = ["BRL", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Status de uma classe frente à sua banda de política. */
export type AllocationStatus = "SOBREPESO" | "NEUTRO" | "SUBPESO";

/**
 * Severidade para o semáforo da UI.
 * OK = verde, ATENCAO = amarelo, VIOLACAO = vermelho.
 */
export type PolicySeverity = "OK" | "ATENCAO" | "VIOLACAO";

/** Escopos configuráveis de limite de risco. */
export type RiskLimitScope =
  | "SINGLE_ASSET"
  | "RISK_BUCKET"
  | "SECTOR"
  | "COUNTRY"
  | "CURRENCY";

export type SnapshotStatus = "RASCUNHO" | "FECHADO";

export type CashFlowType = "CONTRIBUTION" | "WITHDRAWAL";
