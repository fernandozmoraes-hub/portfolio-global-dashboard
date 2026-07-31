import type { SupabaseClient } from "@supabase/supabase-js";
import type { PositionInput } from "@/domain/consolidation/consolidate";
import type { DatedPosition } from "@/domain/positions/current";
import type { AssetClassification } from "@/domain/exposure/compute";
import type { FiiType, RateIndex } from "@/domain/exposure/derive";
import type { AllocationTarget } from "@/domain/allocation/gap";
import type { RiskLimit } from "@/domain/risk/limits";
import type {
  DimensionWeight,
  ExposureDimension,
} from "@/domain/exposure/dimensions";
import type { OverrideMap } from "@/domain/exposure/compute";
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
 * Data da posição mais recente da base INTEIRA.
 *
 * ⚠️ NÃO usar para montar a carteira corrente: corretoras fecham em datas
 * diferentes, e um corte global descartaria contas atualizadas em outro dia.
 * Serve apenas como "existe alguma posição?" e como padrão de data para o
 * fechamento mensal. Para a carteira corrente use `getAllPositions` +
 * `resolveCurrentPortfolio`.
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

/**
 * TODAS as posições conhecidas, com sua data.
 *
 * É a entrada de `resolveCurrentPortfolio`, que escolhe — POR CONTA — a data
 * mais recente de cada uma. Buscar tudo de uma vez evita N consultas (uma por
 * conta) e mantém a decisão de qual data usar no domínio, onde é testável.
 */
export async function getAllPositions(
  db: SupabaseClient,
  since?: string,
): Promise<DatedPosition[]> {
  let query = db
    .from("positions")
    .select(
      `quantity, average_cost, current_price, reference_date,
       accounts!inner ( id, name, brokers!inner ( id, name ) ),
       assets!inner ( id, ticker, name, asset_class, risk_bucket, currency, country, sector )`,
    );

  if (since) query = query.gte("reference_date", since);

  const { data, error } = await query.order("reference_date", { ascending: false });
  if (error) throw new Error(`Falha ao ler posições: ${error.message}`);

  const positions: DatedPosition[] = [];

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
      referenceDate: row.reference_date as string,
    });
  }

  return positions;
}

/**
 * Atributos de classificação por ativo: tipo, indexador e estilo.
 *
 * O indexador é a fonte ÚNICA do fator inflação — nunca o nome do papel nem o
 * regime tributário.
 */
export async function getAssetClassifications(
  db: SupabaseClient,
): Promise<Map<string, AssetClassification>> {
  const { data, error } = await db
    .from("assets")
    .select("id, asset_type, indexador, investment_style, fii_type, maturity_date");

  if (error) throw new Error(`Falha ao ler classificação de ativos: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      {
        assetType: row.asset_type as string,
        indexador: (row.indexador as RateIndex) ?? "NONE",
        investmentStyle: (row.investment_style as string) ?? "NAO_APLICAVEL",
        fiiType: (row.fii_type as FiiType) ?? "NAO_APLICAVEL",
        maturityDate: (row.maturity_date as string | null) ?? null,
      },
    ]),
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
    .select(
      "scope, scope_key, max_percentage, warn_percentage, warn_below_percentage, exempt_asset_types",
    )
    .eq("is_active", true);

  if (error) throw new Error(`Falha ao ler limites de risco: ${error.message}`);

  // Nulo nas colunas de limiar significa "este lado não existe", não zero — por
  // isso elas não passam por num(), que converteria null em 0 e deixaria todo
  // limite permanentemente amarelo (ou permanentemente violado, no caso do teto).
  const opcional = (value: unknown): number | null =>
    value === null || value === undefined ? null : num(value);

  return (data ?? []).map((row) => {
    const warn = opcional(row.warn_percentage);
    const warnBelow = opcional(row.warn_below_percentage);
    return {
      scope: row.scope as RiskLimit["scope"],
      scopeKey: (row.scope_key as string | null) ?? null,
      maxPercentage: opcional(row.max_percentage),
      ...(warn === null ? {} : { warnPercentage: warn }),
      ...(warnBelow === null ? {} : { warnBelowPercentage: warnBelow }),
      exemptAssetTypes: (row.exempt_asset_types as string[] | null) ?? [],
    };
  });
}

/**
 * Sobreposições manuais de exposição, indexadas por ativo E dimensão.
 *
 * A ausência de linha para uma dimensão significa "use a derivação automática"
 * — sobrepor MACRO não afeta GEOGRAFIA.
 */
export async function getExposureOverrides(
  db: SupabaseClient,
): Promise<OverrideMap> {
  const { data, error } = await db
    .from("asset_exposure_tags")
    .select("asset_id, dimension, tag, weight");

  if (error) throw new Error(`Falha ao ler tags de exposição: ${error.message}`);

  const map = new Map<string, Map<ExposureDimension, DimensionWeight[]>>();

  for (const row of data ?? []) {
    const assetId = row.asset_id as string;
    const dimension = row.dimension as ExposureDimension;

    let byDimension = map.get(assetId);
    if (!byDimension) {
      byDimension = new Map();
      map.set(assetId, byDimension);
    }

    const list = byDimension.get(dimension) ?? [];
    list.push({ tag: row.tag as string, weight: num(row.weight) });
    byDimension.set(dimension, list);
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
