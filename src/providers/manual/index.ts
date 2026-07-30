import type { SupabaseClient } from "@supabase/supabase-js";
import type { Currency } from "@/domain/shared/types";
import type {
  BenchmarkCode,
  BenchmarkPoint,
  BenchmarkProvider,
  FxProvider,
  FxRate,
  MarketDataProviders,
  PriceProvider,
  Quote,
  QuoteRequest,
} from "@/providers/ports";

/**
 * ADAPTER MANUAL — implementação do MVP.
 *
 * Lê exclusivamente o que o usuário importou (CSV/XLSX/manual) e gravou no
 * banco. Não faz nenhuma chamada de rede, não depende de API key e portanto
 * não introduz nenhum segredo no runtime.
 *
 * É a implementação de referência das portas: qualquer provider automático
 * futuro precisa satisfazer os mesmos contratos.
 */

export class ManualPriceProvider implements PriceProvider {
  readonly name = "manual";

  constructor(private readonly db: SupabaseClient) {}

  async getQuotes(
    requests: readonly QuoteRequest[],
    asOf: string,
  ): Promise<Quote[]> {
    if (requests.length === 0) return [];

    const tickers = [...new Set(requests.map((r) => r.ticker))];

    const { data, error } = await this.db
      .from("positions")
      .select("reference_date, current_price, assets!inner(ticker, exchange, currency)")
      .lte("reference_date", asOf)
      .in("assets.ticker", tickers)
      .order("reference_date", { ascending: false });

    if (error) throw new Error(`Falha ao ler preços manuais: ${error.message}`);

    // Mantém apenas o preço mais recente de cada ticker até a data pedida.
    const latest = new Map<string, Quote>();

    for (const row of (data ?? []) as unknown as ManualPriceRow[]) {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      if (!asset) continue;
      if (latest.has(asset.ticker)) continue;

      latest.set(asset.ticker, {
        ticker: asset.ticker,
        exchange: asset.exchange,
        currency: asset.currency,
        price: Number(row.current_price),
        asOf: row.reference_date,
      });
    }

    return [...latest.values()];
  }
}

interface ManualPriceRow {
  reference_date: string;
  current_price: string | number;
  assets:
    | { ticker: string; exchange: string | null; currency: Currency }
    | { ticker: string; exchange: string | null; currency: Currency }[];
}

export class ManualFxProvider implements FxProvider {
  readonly name = "manual";

  constructor(private readonly db: SupabaseClient) {}

  async getRate(
    from: Currency,
    to: Currency,
    asOf: string,
  ): Promise<FxRate | null> {
    if (from === to) {
      return { from, to, rate: 1, asOf };
    }

    const { data, error } = await this.db
      .from("fx_rates")
      .select("date, rate")
      .eq("currency_from", from)
      .eq("currency_to", to)
      .lte("date", asOf)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Falha ao ler câmbio: ${error.message}`);
    if (!data) return null;

    return { from, to, rate: Number(data.rate), asOf: data.date };
  }
}

export class ManualBenchmarkProvider implements BenchmarkProvider {
  readonly name = "manual";

  constructor(private readonly db: SupabaseClient) {}

  async getSeries(
    code: BenchmarkCode,
    fromMonth: string,
    toMonth: string,
  ): Promise<BenchmarkPoint[]> {
    const { data, error } = await this.db
      .from("benchmark_values")
      .select("reference_month, value, benchmarks!inner(code)")
      .eq("benchmarks.code", code)
      .gte("reference_month", fromMonth)
      .lte("reference_month", toMonth)
      .order("reference_month", { ascending: true });

    if (error) throw new Error(`Falha ao ler benchmark: ${error.message}`);

    return (data ?? []).map((row) => ({
      code,
      referenceMonth: row.reference_month as string,
      value: Number(row.value),
    }));
  }
}

/**
 * Resolve o conjunto de providers ativo.
 * Ponto único de troca quando providers automáticos forem adicionados.
 */
export function createManualProviders(db: SupabaseClient): MarketDataProviders {
  return {
    prices: new ManualPriceProvider(db),
    fx: new ManualFxProvider(db),
    benchmarks: new ManualBenchmarkProvider(db),
  };
}
