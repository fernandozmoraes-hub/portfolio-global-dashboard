import type { Currency } from "@/domain/shared/types";

/**
 * PORTAS DE DADOS DE MERCADO
 * ===========================
 *
 * O sistema não é acoplado a nenhum fornecedor de preços. Estas interfaces são
 * o único contrato que o resto da aplicação conhece.
 *
 * No MVP existe apenas `ManualProvider`, que lê o que o próprio usuário
 * importou. Conectar B3, Alpha Vantage, Yahoo ou o BCB no futuro significa
 * escrever um novo adapter — nenhuma linha de domínio ou de UI muda.
 */

export interface Quote {
  readonly ticker: string;
  readonly exchange: string | null;
  readonly currency: Currency;
  readonly price: number;
  /** Data de referência do preço (ISO yyyy-mm-dd). */
  readonly asOf: string;
}

export interface QuoteRequest {
  readonly ticker: string;
  readonly exchange: string | null;
  readonly currency: Currency;
}

export interface PriceProvider {
  readonly name: string;
  /**
   * Preços na data indicada. Tickers sem preço disponível simplesmente não
   * aparecem no retorno — cabe ao chamador decidir o que fazer com a ausência.
   */
  getQuotes(requests: readonly QuoteRequest[], asOf: string): Promise<Quote[]>;
}

export interface FxRate {
  readonly from: Currency;
  readonly to: Currency;
  readonly rate: number;
  readonly asOf: string;
}

export interface FxProvider {
  readonly name: string;
  getRate(from: Currency, to: Currency, asOf: string): Promise<FxRate | null>;
}

/** Benchmarks acompanhados pelo sistema. */
export const BENCHMARK_CODES = [
  "CDI",
  "IPCA",
  "IBOVESPA",
  "SP500",
  "USDBRL",
] as const;

export type BenchmarkCode = (typeof BENCHMARK_CODES)[number];

export interface BenchmarkPoint {
  readonly code: BenchmarkCode;
  /** Mês de referência (ISO yyyy-mm-01). */
  readonly referenceMonth: string;
  /** Variação percentual no mês, ou nível do índice conforme o benchmark. */
  readonly value: number;
}

export interface BenchmarkProvider {
  readonly name: string;
  getSeries(
    code: BenchmarkCode,
    fromMonth: string,
    toMonth: string,
  ): Promise<BenchmarkPoint[]>;
}

/** Conjunto de providers ativos, resolvido em runtime. */
export interface MarketDataProviders {
  readonly prices: PriceProvider;
  readonly fx: FxProvider;
  readonly benchmarks: BenchmarkProvider;
}
