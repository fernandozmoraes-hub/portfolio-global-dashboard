import type { SupabaseClient } from "@supabase/supabase-js";
import type { PositionInput } from "@/domain/consolidation/consolidate";
import type { AllocationTarget } from "@/domain/allocation/gap";
import type { RiskLimit } from "@/domain/risk/limits";
import type { FactorWeight, RiskFactor } from "@/domain/factors/types";
import type { CashFlow } from "@/domain/performance/dietz";
import type { FxTable } from "@/domain/money/convert";
import type { AssetClass, Currency, RiskBucket } from "@/domain/shared/types";

/**
 * Acesso a dados da carteira.
 *
 * Responsabilidade única: buscar linhas e converter para os tipos do domínio.
 * Nenhum cálculo financeiro acontece aqui.
 *
 * `supabase-js` devolve colunas `numeric` como STRING para não perder precisão.
 * A conversão é centralizada em `num()` — se ficasse espalhada, um `+` em cima
 * de string viraria concatenação silenciosa.
 */

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Primeiro elemento quando o join devolve array, ou o próprio objeto. */
function one<T>(value: T | T[] | null): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export interface PortfolioSnapshotRow {
  readonly id: string;
  readonly referenceDate: string;
  readonly totalValueBRL: number;
  readonly realEstateValueBRL: number;
  readonly contributionsMonth: number;
  readonly withdrawalsMonth: number;
  readonly usdBrlRate: number | null;
}

export interface RealEstateRow {
  readonly id: string;
  readonly description: string;
  readonly estimatedValue: number;
  readonly includeInRetirementPortfolio: boolean;
}

/**
 * Data de referência das posições mais recentes.
 * `null` quando ainda não há nenhuma posição — carteira nova, sem importação.
 */
export async function getLatestPositionDate(
  db: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await db
    .from("positions")
    .select("reference_date")
    .order("reference_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler data das posições: ${error.message}`);
  return (data?.reference_date as string | undefined) ?? null;
}

/** Posições de uma data, já no formato do domínio. */
export async function getPositions(
  db: SupabaseClient,
  referenceDate: string,
): Promise<PositionInput[]> {
  const { data, error } = await db
    .from("positions")
    .select(
      `quantity, average_cost, current_price,
       accounts!inner ( id, name, brokers!inner ( id, name ) ),
       assets!inner ( id, ticker, name, asset_class, risk_bucket, currency, country, sector, asset_type )`,
    )
    .eq("reference_date", referenceDate);

  if (error) throw new Error(`Falha ao ler posições: ${error.message}`);

  const positions: PositionInput[] = [];

  for (const row of data ?? []) {
    const account = one(row.accounts as never);
    const asset = one(row.assets as never);
    if (!account || !asset) continue;

    const broker = one((account as { brokers: unknown }).brokers as never);
    if (!broker) continue;

    const a = asset as {
      id: string; ticker: string; name: string; asset_class: AssetClass;
      risk_bucket: RiskBucket; currency: Currency; country: string; sector: string | null;
    };
    const ac = account as { id: string; name: string };
    const b = broker as { id: string; name: string };

    positions.push({
      accountId: ac.id,
      accountName: ac.name,
      brokerId: b.id,
      brokerName: b.name,
      assetId: a.id,
      ticker: a.ticker,
      assetName: a.name,
      assetClass: a.asset_class,
      riskBucket: a.risk_bucket,
      currency: a.currency,
      country: a.country,
      sector: a.sector,
      quantity: num(row.quantity),
      averageCost: numOrNull(row.average_cost),
      currentPrice: num(row.current_price),
    });
  }

  return positions;
}

/** Mapa assetId -> asset_type, usado pela derivação de fatores. */
export async function getAssetTypes(
  db: SupabaseClient,
): Promise<Map<string, string>> {
  const { data, error } = await db.from("assets").select("id, asset_type");
  if (error) throw new Error(`Falha ao ler tipos de ativo: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [row.id as string, row.asset_type as string]),
  );
}

/**
 * Taxas de câmbio vigentes em uma data (a mais recente até ela).
 * Um câmbio ausente NÃO vira 1 — o domínio erra explicitamente.
 */
export async function getFxTable(
  db: SupabaseClient,
  asOf: string,
): Promise<FxTable> {
  const { data, error } = await db
    .from("fx_rates")
    .select("currency_from, rate, date")
    .eq("currency_to", "BRL")
    .lte("date", asOf)
    .order("date", { ascending: false });

  if (error) throw new Error(`Falha ao ler câmbio: ${error.message}`);

  const table: Record<string, number> = {};
  for (const row of data ?? []) {
    const currency = row.currency_from as string;
    if (table[currency] === undefined) table[currency] = num(row.rate);
  }
  return table as FxTable;
}

export async function getAllocationTargets(
  db: SupabaseClient,
): Promise<AllocationTarget[]> {
  const { data, error } = await db
    .from("allocation_targets")
    .select("asset_class, target_percentage, minimum_percentage, maximum_percentage");

  if (error) throw new Error(`Falha ao ler política: ${error.message}`);

  return (data ?? []).map((row) => ({
    assetClass: row.asset_class as AssetClass,
    targetPercentage: num(row.target_percentage),
    minimumPercentage: num(row.minimum_percentage),
    maximumPercentage: num(row.maximum_percentage),
  }));
}

export async function getRiskLimits(db: SupabaseClient): Promise<RiskLimit[]> {
  const { data, error } = await db
    .from("risk_limits")
    .select("scope, scope_key, max_percentage")
    .eq("is_active", true);

  if (error) throw new Error(`Falha ao ler limites de risco: ${error.message}`);

  return (data ?? []).map((row) => ({
    scope: row.scope as RiskLimit["scope"],
    scopeKey: (row.scope_key as string | null) ?? null,
    maxPercentage: num(row.max_percentage),
  }));
}

/** Sobreposições manuais de fator, por ativo. */
export async function getFactorOverrides(
  db: SupabaseClient,
): Promise<Map<string, FactorWeight[]>> {
  const { data, error } = await db
    .from("asset_risk_factors")
    .select("asset_id, factor_code, weight");

  if (error) throw new Error(`Falha ao ler fatores: ${error.message}`);

  const map = new Map<string, FactorWeight[]>();
  for (const row of data ?? []) {
    const assetId = row.asset_id as string;
    const list = map.get(assetId) ?? [];
    list.push({
      factor: row.factor_code as RiskFactor,
      weight: num(row.weight),
    });
    map.set(assetId, list);
  }
  return map;
}

/** Fechamentos confirmados, do mais antigo ao mais recente. */
export async function getClosedSnapshots(
  db: SupabaseClient,
  limit = 36,
): Promise<PortfolioSnapshotRow[]> {
  const { data, error } = await db
    .from("portfolio_snapshots")
    .select(
      "id, reference_date, total_value_brl, real_estate_value_brl, contributions_month, withdrawals_month, usd_brl_rate",
    )
    .eq("status", "FECHADO")
    .order("reference_date", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Falha ao ler fechamentos: ${error.message}`);

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      referenceDate: row.reference_date as string,
      totalValueBRL: num(row.total_value_brl),
      realEstateValueBRL: num(row.real_estate_value_brl),
      contributionsMonth: num(row.contributions_month),
      withdrawalsMonth: num(row.withdrawals_month),
      usdBrlRate: numOrNull(row.usd_brl_rate),
    }))
    .reverse();
}

/**
 * Fluxos de caixa COM DATA REAL num intervalo.
 *
 * É esta consulta que permite ao Modified Dietz ponderar cada aporte pelo tempo
 * em que ficou investido, em vez de assumir o meio do período.
 */
export async function getCashFlows(
  db: SupabaseClient,
  from: string,
  to: string,
): Promise<CashFlow[]> {
  const { data, error } = await db
    .from("portfolio_cash_flows")
    .select("date, flow_type, amount_brl")
    .gt("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) throw new Error(`Falha ao ler fluxos de caixa: ${error.message}`);

  return (data ?? []).map((row) => ({
    date: row.date as string,
    type: row.flow_type as CashFlow["type"],
    amountBRL: num(row.amount_brl),
  }));
}

export async function getRealEstate(
  db: SupabaseClient,
): Promise<RealEstateRow[]> {
  const { data, error } = await db
    .from("real_estate")
    .select("id, description, estimated_value, include_in_retirement_portfolio");

  if (error) throw new Error(`Falha ao ler imóveis: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    description: row.description as string,
    estimatedValue: num(row.estimated_value),
    includeInRetirementPortfolio: Boolean(row.include_in_retirement_portfolio),
  }));
}

export interface TransactionRow {
  readonly id: string;
  readonly date: string;
  readonly type: string;
  readonly quantity: number | null;
  readonly price: number | null;
  readonly fees: number;
  readonly taxes: number;
  readonly currency: Currency;
  readonly brokerName: string;
}

export interface IncomeRow {
  readonly id: string;
  readonly date: string;
  readonly type: string;
  readonly grossAmount: number;
  readonly taxes: number;
  readonly netAmount: number;
  readonly currency: Currency;
  readonly brokerName: string;
}

export async function getTransactionsByAsset(
  db: SupabaseClient,
  assetId: string,
): Promise<TransactionRow[]> {
  const { data, error } = await db
    .from("transactions")
    .select(
      `id, date, transaction_type, quantity, price, fees, taxes, currency,
       accounts!inner ( brokers!inner ( name ) )`,
    )
    .eq("asset_id", assetId)
    .order("date", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Falha ao ler transações: ${error.message}`);

  return (data ?? []).map((row) => {
    const account = one(row.accounts as never) as { brokers: unknown } | null;
    const broker = account ? (one(account.brokers as never) as { name: string } | null) : null;
    return {
      id: row.id as string,
      date: row.date as string,
      type: row.transaction_type as string,
      quantity: numOrNull(row.quantity),
      price: numOrNull(row.price),
      fees: num(row.fees),
      taxes: num(row.taxes),
      currency: row.currency as Currency,
      brokerName: broker?.name ?? "—",
    };
  });
}

export async function getIncomeByAsset(
  db: SupabaseClient,
  assetId: string,
): Promise<IncomeRow[]> {
  const { data, error } = await db
    .from("income")
    .select(
      `id, date, income_type, gross_amount, taxes, net_amount, currency,
       accounts!inner ( brokers!inner ( name ) )`,
    )
    .eq("asset_id", assetId)
    .order("date", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Falha ao ler rendimentos: ${error.message}`);

  return (data ?? []).map((row) => {
    const account = one(row.accounts as never) as { brokers: unknown } | null;
    const broker = account ? (one(account.brokers as never) as { name: string } | null) : null;
    return {
      id: row.id as string,
      date: row.date as string,
      type: row.income_type as string,
      grossAmount: num(row.gross_amount),
      taxes: num(row.taxes),
      netAmount: num(row.net_amount),
      currency: row.currency as Currency,
      brokerName: broker?.name ?? "—",
    };
  });
}

/** Existe algum dado demonstrativo na base? Controla o aviso de seed na UI. */
export async function hasDemoData(db: SupabaseClient): Promise<boolean> {
  const { count, error } = await db
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("is_demo", true);

  if (error) return false;
  return (count ?? 0) > 0;
}
