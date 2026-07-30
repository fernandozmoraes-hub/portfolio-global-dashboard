import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consolidatePositions,
  totalFinancialValueBRL,
  type AssetExposure,
} from "@/domain/consolidation/consolidate";
import { evaluateRiskLimits, type RiskLimit } from "@/domain/risk/limits";
import { resolveDimension } from "@/domain/exposure/derive";
import {
  resolveCurrentPortfolio,
  type SourceFreshness,
} from "@/domain/positions/current";
import {
  EXPOSURE_DIMENSIONS,
  type DimensionWeight,
  type ExposureDimension,
} from "@/domain/exposure/dimensions";
import type { PolicySeverity } from "@/domain/shared/types";
import { round4 } from "@/domain/money/types";
import * as repo from "@/data/repositories/portfolio";

/**
 * Dados das telas de Carteira.
 *
 * Como no Dashboard, nada aqui depende do seed: sem posições, devolve listas
 * vazias e a UI mostra o estado vazio.
 */

export interface PortfolioRow {
  readonly assetId: string;
  readonly ticker: string;
  readonly assetName: string;
  readonly assetClass: string;
  readonly sector: string | null;
  readonly country: string;
  readonly currency: string;
  readonly riskBucket: string;
  /** Nomes das corretoras onde o ativo está custodiado. */
  readonly brokers: readonly string[];
  readonly valueBRL: number;
  readonly weight: number;
  readonly averageCost: number | null;
  readonly unrealizedResultBRL: number | null;
  readonly unrealizedResultPercent: number | null;
  /** Teto aplicável ao ativo conforme seu risk bucket. `null` se não houver. */
  readonly maxWeight: number | null;
  readonly severity: PolicySeverity;
}

export interface PortfolioView {
  readonly referenceDate: string | null;
  readonly sources: readonly SourceFreshness[];
  readonly hasMixedDates: boolean;
  readonly hasStaleSources: boolean;
  readonly totalBRL: number;
  readonly rows: readonly PortfolioRow[];
  readonly hasDemoData: boolean;
}

export async function getPortfolioView(
  db: SupabaseClient,
): Promise<PortfolioView> {
  const [referenceDate, hasDemo] = await Promise.all([
    repo.getLatestPositionDate(db),
    repo.hasDemoData(db),
  ]);

  if (referenceDate === null) {
    return {
      referenceDate: null, sources: [], hasMixedDates: false,
      hasStaleSources: false, totalBRL: 0, rows: [], hasDemoData: hasDemo,
    };
  }

  const [allPositions, fx, limits] = await Promise.all([
    repo.getAllPositions(db),
    repo.getFxTable(db, referenceDate),
    repo.getRiskLimits(db),
  ]);

  const current = resolveCurrentPortfolio(allPositions, referenceDate, fx);
  const exposures = consolidatePositions(current.positions, fx);
  const totalBRL = totalFinancialValueBRL(exposures);
  const alerts = evaluateRiskLimits(exposures, limits);

  const severityByTicker = new Map(
    alerts
      .filter((alert) => alert.scope === "SINGLE_ASSET")
      .map((alert) => [alert.subject, alert.severity] as const),
  );

  const rows = exposures.map((exposure) => ({
    assetId: exposure.assetId,
    ticker: exposure.ticker,
    assetName: exposure.assetName,
    assetClass: exposure.assetClass,
    sector: exposure.sector,
    country: exposure.country,
    currency: exposure.currency,
    riskBucket: exposure.riskBucket,
    brokers: [...new Set(exposure.custodies.map((c) => c.brokerName))],
    valueBRL: exposure.valueBRL,
    weight: totalBRL === 0 ? 0 : round4((exposure.valueBRL / totalBRL) * 100),
    averageCost: exposure.averageCost,
    unrealizedResultBRL: exposure.unrealizedResultBRL,
    unrealizedResultPercent: exposure.unrealizedResultPercent,
    maxWeight: maxWeightFor(exposure, limits),
    severity: severityByTicker.get(exposure.ticker) ?? "OK",
  }));

  return {
    referenceDate: current.newestDate ?? referenceDate,
    sources: current.sources,
    hasMixedDates: current.hasMixedDates,
    hasStaleSources: current.hasStaleSources,
    totalBRL,
    rows,
    hasDemoData: hasDemo,
  };
}

/** Teto individual aplicável ao ativo, conforme seu risk bucket. */
function maxWeightFor(
  exposure: AssetExposure,
  limits: readonly RiskLimit[],
): number | null {
  const specific = limits.find(
    (limit) =>
      limit.scope === "SINGLE_ASSET" && limit.scopeKey === exposure.riskBucket,
  );
  if (specific) return specific.maxPercentage;

  const global = limits.find(
    (limit) => limit.scope === "SINGLE_ASSET" && limit.scopeKey === null,
  );
  return global?.maxPercentage ?? null;
}

// ---------------------------------------------------------------------------
// Detalhe do ativo
// ---------------------------------------------------------------------------

export interface AssetDetail {
  readonly exposure: AssetExposure;
  readonly weight: number;
  readonly maxWeight: number | null;
  readonly severity: PolicySeverity;
  /** Tags do ativo em cada dimensão, com indicação de sobreposição manual. */
  readonly dimensions: readonly {
    dimension: ExposureDimension;
    tags: readonly DimensionWeight[];
    isOverridden: boolean;
  }[];
  readonly transactions: readonly repo.TransactionRow[];
  readonly income: readonly repo.IncomeRow[];
}

export async function getAssetDetail(
  db: SupabaseClient,
  assetId: string,
): Promise<AssetDetail | null> {
  const referenceDate = await repo.getLatestPositionDate(db);
  if (referenceDate === null) return null;

  const [allPositions, fx, limits, overrides, classifications, transactions, income] =
    await Promise.all([
      repo.getAllPositions(db),
      repo.getFxTable(db, referenceDate),
      repo.getRiskLimits(db),
      repo.getExposureOverrides(db),
      repo.getAssetClassifications(db),
      repo.getTransactionsByAsset(db, assetId),
      repo.getIncomeByAsset(db, assetId),
    ]);

  const current = resolveCurrentPortfolio(allPositions, referenceDate, fx);
  const exposures = consolidatePositions(current.positions, fx);
  const totalBRL = totalFinancialValueBRL(exposures);
  const exposure = exposures.find((item) => item.assetId === assetId);
  if (!exposure) return null;

  const alerts = evaluateRiskLimits(exposures, limits);
  const alert = alerts.find(
    (item) => item.scope === "SINGLE_ASSET" && item.subject === exposure.ticker,
  );

  const assetOverrides = overrides.get(assetId);
  const classification = classifications.get(assetId);
  const tags = {
    assetType: classification?.assetType ?? "OUTROS",
    assetClass: exposure.assetClass,
    country: exposure.country,
    currency: exposure.currency,
    rawSector: exposure.sector,
    riskBucket: exposure.riskBucket,
    investmentStyle: classification?.investmentStyle ?? "NAO_APLICAVEL",
    indexador: classification?.indexador ?? ("NONE" as const),
    name: exposure.assetName,
  };

  return {
    exposure,
    weight: totalBRL === 0 ? 0 : round4((exposure.valueBRL / totalBRL) * 100),
    maxWeight: maxWeightFor(exposure, limits),
    severity: alert?.severity ?? "OK",
    dimensions: EXPOSURE_DIMENSIONS.map((dimension) => {
      const override = assetOverrides?.get(dimension);
      return {
        dimension,
        tags: resolveDimension(tags, dimension, override),
        isOverridden: override !== undefined && override.length > 0,
      };
    }),
    transactions,
    income,
  };
}
