import { round2, round4 } from "@/domain/money/types";
import type { AssetExposure } from "@/domain/consolidation/consolidate";
import { totalFinancialValueBRL } from "@/domain/consolidation/consolidate";
import {
  resolveDimension,
  labelForSharedTag,
  type AssetTags,
  type FiiType,
  type RateIndex,
} from "./derive";
import {
  EXPOSURE_DIMENSIONS,
  DIMENSION_KIND,
  DIMENSION_LABELS,
  DIMENSION_QUESTIONS,
  labelFor,
  type DimensionExposure,
  type DimensionWeight,
  type ExposureBucket,
  type ExposureDimension,
} from "./dimensions";

/**
 * Calcula a exposição da carteira em TODAS as dimensões.
 *
 * Cada dimensão é uma partição completa e independente do patrimônio: dentro
 * dela os percentuais somam 100%. Entre dimensões não há soma — o mesmo real
 * é contado integralmente em cada uma.
 *
 * Sempre sobre a EXPOSIÇÃO CONSOLIDADA. GOOGL da Avenue e da Interactive
 * Brokers são somados antes de classificar: corretora é custódia, e classificar
 * por corretora esconderia justamente a concentração que se quer medir.
 */

/** Sobreposições manuais: assetId -> dimensão -> pesos. */
export type OverrideMap = ReadonlyMap<
  string,
  ReadonlyMap<ExposureDimension, readonly DimensionWeight[]>
>;

/** Atributos de classificação que não viajam na exposição consolidada. */
export interface AssetClassification {
  readonly assetType: string;
  readonly indexador: RateIndex;
  readonly investmentStyle: string;
  readonly fiiType: FiiType;
  readonly maturityDate: string | null;
}

export function computeDimensionalExposure(
  exposures: readonly AssetExposure[],
  overrides: OverrideMap = new Map(),
  classificationById: ReadonlyMap<string, AssetClassification> = new Map(),
): DimensionExposure[] {
  const totalBRL = totalFinancialValueBRL(exposures);
  if (totalBRL === 0 || exposures.length === 0) return [];

  return EXPOSURE_DIMENSIONS.map((dimension) =>
    computeSingleDimension(dimension, exposures, overrides, classificationById, totalBRL),
  );
}

/** Uma dimensão isolada — útil para telas que só precisam de um recorte. */
export function computeSingleDimension(
  dimension: ExposureDimension,
  exposures: readonly AssetExposure[],
  overrides: OverrideMap,
  classificationById: ReadonlyMap<string, AssetClassification>,
  totalBRL: number,
): DimensionExposure {
  const valueByTag = new Map<string, number>();
  const assetsByTag = new Map<string, Set<string>>();

  for (const exposure of exposures) {
    const tags = resolveDimension(
      toAssetTags(exposure, classificationById),
      dimension,
      overrides.get(exposure.assetId)?.get(dimension),
    );

    for (const { tag, weight } of tags) {
      valueByTag.set(tag, (valueByTag.get(tag) ?? 0) + exposure.valueBRL * weight);

      let bucket = assetsByTag.get(tag);
      if (!bucket) {
        bucket = new Set();
        assetsByTag.set(tag, bucket);
      }
      bucket.add(exposure.assetId);
    }
  }

  const buckets: ExposureBucket[] = [...valueByTag.entries()]
    .map(([tag, valueBRL]) => ({
      tag,
      label: labelForSharedTag(dimension, tag) ?? labelFor(dimension, tag),
      valueBRL: round2(valueBRL),
      percentage: round4((valueBRL / totalBRL) * 100),
      assetCount: assetsByTag.get(tag)?.size ?? 0,
    }))
    .sort((a, b) => b.valueBRL - a.valueBRL);

  return {
    dimension,
    kind: DIMENSION_KIND[dimension],
    label: DIMENSION_LABELS[dimension],
    question: DIMENSION_QUESTIONS[dimension],
    buckets,
    totalBRL: round2(totalBRL),
    // Em sobreposição a soma ultrapassa 100% — e isso é correto: o mesmo
    // real reage a mais de um fator ao mesmo tempo.
    percentageSum: round4(buckets.reduce((acc, b) => acc + b.percentage, 0)),
  };
}

function toAssetTags(
  exposure: AssetExposure,
  classificationById: ReadonlyMap<string, AssetClassification>,
): AssetTags {
  const classification = classificationById.get(exposure.assetId);
  return {
    assetType: classification?.assetType ?? fallbackType(exposure.assetClass),
    assetClass: exposure.assetClass,
    country: exposure.country,
    currency: exposure.currency,
    rawSector: exposure.sector,
    riskBucket: exposure.riskBucket,
    investmentStyle: classification?.investmentStyle ?? "NAO_APLICAVEL",
    indexador: classification?.indexador ?? "NONE",
    fiiType: classification?.fiiType ?? "NAO_APLICAVEL",
    maturityDate: classification?.maturityDate ?? null,
    name: exposure.assetName,
  };
}

/** Proxy de tipo quando o instrumento não é conhecido (importação parcial). */
function fallbackType(assetClass: string): string {
  switch (assetClass) {
    case "RF_BRASIL":
      return "CDB";
    case "ACOES_BRASIL":
    case "ACOES_ETF_EXTERIOR":
      return "ACAO";
    case "RF_CAIXA_EXTERIOR":
      return "BOND";
    case "FII_IMOBILIARIO":
      return "FII";
    case "MULTIMERCADO_ALTERNATIVO":
      return "FUNDO";
    case "CAIXA_BR":
      return "CAIXA";
    default:
      return "OUTROS";
  }
}

/**
 * Percentual não classificado numa dimensão.
 * Mede a qualidade da derivação — quanto maior, mais classificação manual falta.
 */
export function unclassifiedShare(dimension: DimensionExposure): number {
  return dimension.buckets
    .filter(
      (b) =>
        b.tag === "OUTROS" ||
        b.tag === "NAO_APLICAVEL" ||
        b.tag === "NAO_CLASSIFICADO",
    )
    .reduce((acc, b) => acc + b.percentage, 0);
}

/** Maior concentração de uma dimensão — alimenta a leitura de risco. */
export function topBucket(dimension: DimensionExposure): ExposureBucket | null {
  return dimension.buckets[0] ?? null;
}
