import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consolidatePositions,
  groupExposureBy,
  totalFinancialValueBRL,
  type AssetExposure,
} from "@/domain/consolidation/consolidate";
import { computeAllocation, type ClassAllocation } from "@/domain/allocation/gap";
import { evaluateRiskLimits, type RiskAlert } from "@/domain/risk/limits";
import { computeDimensionalExposure } from "@/domain/exposure/compute";
import type { DimensionExposure } from "@/domain/exposure/dimensions";
import {
  computePeriodReturn,
  linkReturns,
  type PeriodReturnResult,
} from "@/domain/performance/dietz";
import { round2, round4 } from "@/domain/money/types";
import * as repo from "@/data/repositories/portfolio";

/**
 * Monta os dados do Dashboard.
 *
 * PRINCÍPIO: nada aqui pressupõe o seed. Uma base recém-criada, sem nenhuma
 * posição, produz um `DashboardData` válido com listas vazias e métricas
 * `null` — a UI renderiza estados vazios úteis em vez de quebrar.
 */

export interface DimensionSlice {
  readonly key: string;
  readonly valueBRL: number;
  readonly weight: number;
}

export interface EvolutionPoint {
  readonly referenceDate: string;
  readonly portfolio: number;
  readonly cumulativeContributions: number;
}

export interface DashboardData {
  /** `null` quando não há nenhuma posição importada. */
  readonly referenceDate: string | null;
  readonly isEmpty: boolean;
  readonly hasDemoData: boolean;

  readonly totalFinancialBRL: number;
  readonly realEstateBRL: number;
  readonly totalWithRealEstateBRL: number;

  readonly contributionsMonth: number | null;
  readonly monthlyReturn: PeriodReturnResult | null;
  readonly ytdReturnPercent: number | null;
  readonly closedMonthsCount: number;

  readonly exposures: readonly AssetExposure[];
  readonly topExposures: readonly AssetExposure[];
  readonly allocation: readonly ClassAllocation[];

  readonly byCountry: readonly DimensionSlice[];
  readonly byCurrency: readonly DimensionSlice[];
  readonly bySector: readonly DimensionSlice[];
  readonly byRiskBucket: readonly DimensionSlice[];
  /**
   * Exposição em dimensões independentes. Dentro de cada uma os percentuais
   * somam 100%; entre dimensões não há soma.
   */
  readonly dimensions: readonly DimensionExposure[];

  readonly alerts: readonly RiskAlert[];
  readonly evolution: readonly EvolutionPoint[];

  /** Percentuais agregados exibidos nos cards. */
  readonly brazilPercent: number | null;
  readonly foreignPercent: number | null;
  readonly brlPercent: number | null;
  readonly usdPercent: number | null;
}

const EMPTY: DashboardData = {
  referenceDate: null,
  isEmpty: true,
  hasDemoData: false,
  totalFinancialBRL: 0,
  realEstateBRL: 0,
  totalWithRealEstateBRL: 0,
  contributionsMonth: null,
  monthlyReturn: null,
  ytdReturnPercent: null,
  closedMonthsCount: 0,
  exposures: [],
  topExposures: [],
  allocation: [],
  byCountry: [],
  byCurrency: [],
  bySector: [],
  byRiskBucket: [],
  dimensions: [],
  alerts: [],
  evolution: [],
  brazilPercent: null,
  foreignPercent: null,
  brlPercent: null,
  usdPercent: null,
};

export async function getDashboardData(
  db: SupabaseClient,
): Promise<DashboardData> {
  const [referenceDate, realEstate, snapshots, hasDemo] = await Promise.all([
    repo.getLatestPositionDate(db),
    repo.getRealEstate(db),
    repo.getClosedSnapshots(db),
    repo.hasDemoData(db),
  ]);

  const realEstateBRL = round2(
    realEstate
      .filter((item) => !item.includeInRetirementPortfolio)
      .reduce((acc, item) => acc + item.estimatedValue, 0),
  );

  // Carteira ainda sem posições: devolve estrutura válida e vazia.
  if (referenceDate === null) {
    return {
      ...EMPTY,
      hasDemoData: hasDemo,
      realEstateBRL,
      totalWithRealEstateBRL: realEstateBRL,
      evolution: buildEvolution(snapshots),
      closedMonthsCount: snapshots.length,
    };
  }

  const [positions, fx, targets, limits, overrides, assetTypes] =
    await Promise.all([
      repo.getPositions(db, referenceDate),
      repo.getFxTable(db, referenceDate),
      repo.getAllocationTargets(db),
      repo.getRiskLimits(db),
      repo.getExposureOverrides(db),
      repo.getAssetTypes(db),
    ]);

  const exposures = consolidatePositions(positions, fx);
  const totalFinancialBRL = totalFinancialValueBRL(exposures);

  const byCountry = groupExposureBy(exposures, (e) => e.country);
  const byCurrency = groupExposureBy(exposures, (e) => e.currency);
  const bySector = groupExposureBy(exposures, (e) => e.sector ?? "Não classificado");
  const byRiskBucket = groupExposureBy(exposures, (e) => e.riskBucket);

  const monthlyReturn = await computeMonthlyReturn(db, snapshots);
  const ytdReturnPercent = await computeYtdReturn(db, snapshots);

  const brazil = byCountry.find((slice) => slice.key === "BR")?.weight ?? 0;
  const brl = byCurrency.find((slice) => slice.key === "BRL")?.weight ?? 0;
  const usd = byCurrency.find((slice) => slice.key === "USD")?.weight ?? 0;

  return {
    referenceDate,
    isEmpty: exposures.length === 0,
    hasDemoData: hasDemo,

    totalFinancialBRL,
    realEstateBRL,
    totalWithRealEstateBRL: round2(totalFinancialBRL + realEstateBRL),

    contributionsMonth: snapshots.at(-1)?.contributionsMonth ?? null,
    monthlyReturn,
    ytdReturnPercent,
    closedMonthsCount: snapshots.length,

    exposures,
    topExposures: exposures.slice(0, 10),
    allocation: computeAllocation(exposures, targets),

    byCountry,
    byCurrency,
    bySector,
    byRiskBucket,
    dimensions: computeDimensionalExposure(exposures, overrides, assetTypes),

    alerts: evaluateRiskLimits(exposures, limits),
    evolution: buildEvolution(snapshots),

    brazilPercent: exposures.length === 0 ? null : brazil,
    foreignPercent: exposures.length === 0 ? null : round4(100 - brazil),
    brlPercent: exposures.length === 0 ? null : brl,
    usdPercent: exposures.length === 0 ? null : usd,
  };
}

/**
 * Retorno do último mês fechado.
 *
 * Exige DOIS fechamentos. Com menos que isso devolve `null` e a UI mostra "—":
 * o sistema não estima rentabilidade.
 */
async function computeMonthlyReturn(
  db: SupabaseClient,
  snapshots: readonly repo.PortfolioSnapshotRow[],
): Promise<PeriodReturnResult | null> {
  if (snapshots.length < 2) return null;

  const previous = snapshots.at(-2);
  const current = snapshots.at(-1);
  if (!previous || !current) return null;

  // Fluxos COM DATA REAL do período: é o que permite a ponderação temporal
  // correta, em vez do peso fixo de meio de período.
  const flows = await repo.getCashFlows(
    db,
    previous.referenceDate,
    current.referenceDate,
  );

  return computePeriodReturn(
    {
      start: previous.referenceDate,
      end: current.referenceDate,
      startValue: previous.totalValueBRL,
      endValue: current.totalValueBRL,
      flows,
    },
    current.contributionsMonth - current.withdrawalsMonth,
  );
}

/**
 * YTD por encadeamento geométrico dos meses fechados do ano corrente.
 * Neutraliza o efeito dos aportes — que é justamente o objetivo do TWR.
 */
async function computeYtdReturn(
  db: SupabaseClient,
  snapshots: readonly repo.PortfolioSnapshotRow[],
): Promise<number | null> {
  if (snapshots.length < 2) return null;

  const lastDate = snapshots.at(-1)?.referenceDate;
  if (!lastDate) return null;

  const year = lastDate.slice(0, 4);
  const monthly: number[] = [];

  for (let i = 1; i < snapshots.length; i += 1) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    if (!previous || !current) continue;
    if (!current.referenceDate.startsWith(year)) continue;

    const flows = await repo.getCashFlows(
      db,
      previous.referenceDate,
      current.referenceDate,
    );

    const result = computePeriodReturn(
      {
        start: previous.referenceDate,
        end: current.referenceDate,
        startValue: previous.totalValueBRL,
        endValue: current.totalValueBRL,
        flows,
      },
      current.contributionsMonth - current.withdrawalsMonth,
    );

    if (result !== null) monthly.push(result.returnPercent);
  }

  return linkReturns(monthly);
}

/** Série de evolução patrimonial com aportes acumulados. */
function buildEvolution(
  snapshots: readonly repo.PortfolioSnapshotRow[],
): EvolutionPoint[] {
  let cumulative = 0;
  return snapshots.map((snapshot) => {
    cumulative += snapshot.contributionsMonth - snapshot.withdrawalsMonth;
    return {
      referenceDate: snapshot.referenceDate,
      portfolio: snapshot.totalValueBRL,
      cumulativeContributions: round2(cumulative),
    };
  });
}
