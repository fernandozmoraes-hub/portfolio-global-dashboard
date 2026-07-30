import type {
  AllocationStatus,
  AssetClass,
  PolicySeverity,
} from "@/domain/shared/types";
import { ASSET_CLASSES } from "@/domain/shared/types";
import { round2, round4 } from "@/domain/money/types";
import type { AssetExposure } from "@/domain/consolidation/consolidate";
import { totalFinancialValueBRL } from "@/domain/consolidation/consolidate";

/** Uma linha da política de investimentos. */
export interface AllocationTarget {
  readonly assetClass: AssetClass;
  /** Alvo em % (0-100). */
  readonly targetPercentage: number;
  /** Banda inferior em % (0-100). */
  readonly minimumPercentage: number;
  /** Banda superior em % (0-100). */
  readonly maximumPercentage: number;
}

/** Situação de uma classe frente à política. */
export interface ClassAllocation {
  readonly assetClass: AssetClass;
  readonly currentValueBRL: number;
  /** Peso atual em % (0-100). */
  readonly currentPercentage: number;
  readonly targetPercentage: number;
  readonly minimumPercentage: number;
  readonly maximumPercentage: number;
  /** Desvio em pontos percentuais: atual - alvo. Negativo = subalocado. */
  readonly gapPercentagePoints: number;
  /** Quanto falta (negativo) ou sobra (positivo) em R$ para atingir o alvo. */
  readonly gapBRL: number;
  readonly status: AllocationStatus;
  readonly severity: PolicySeverity;
}

/**
 * Fração da largura da banda que, quando ultrapassada em direção a uma
 * extremidade, muda o semáforo de verde para amarelo.
 */
const ATTENTION_BAND_FRACTION = 0.2;

/**
 * Classifica uma classe frente à sua banda.
 *
 * SOBREPESO  = acima da banda máxima
 * SUBPESO    = abaixo da banda mínima
 * NEUTRO     = dentro da banda
 */
export function classifyAllocation(
  currentPercentage: number,
  target: AllocationTarget,
): { status: AllocationStatus; severity: PolicySeverity } {
  if (currentPercentage > target.maximumPercentage) {
    return { status: "SOBREPESO", severity: "VIOLACAO" };
  }
  if (currentPercentage < target.minimumPercentage) {
    return { status: "SUBPESO", severity: "VIOLACAO" };
  }

  // Dentro da banda: verifica proximidade das extremidades para o amarelo.
  const bandWidth = target.maximumPercentage - target.minimumPercentage;
  if (bandWidth > 0) {
    const margin = bandWidth * ATTENTION_BAND_FRACTION;
    const nearTop = currentPercentage > target.maximumPercentage - margin;
    const nearBottom = currentPercentage < target.minimumPercentage + margin;
    if (nearTop || nearBottom) {
      return { status: "NEUTRO", severity: "ATENCAO" };
    }
  }

  return { status: "NEUTRO", severity: "OK" };
}

/**
 * Calcula a situação de todas as classes da política.
 *
 * Classes presentes na política mas sem posição aparecem com valor 0 — é
 * justamente o caso que precisa de aporte, então não podem sumir da tela.
 */
export function computeAllocation(
  exposures: readonly AssetExposure[],
  targets: readonly AllocationTarget[],
): ClassAllocation[] {
  const totalBRL = totalFinancialValueBRL(exposures);

  const valueByClass = new Map<AssetClass, number>();
  for (const exposure of exposures) {
    valueByClass.set(
      exposure.assetClass,
      (valueByClass.get(exposure.assetClass) ?? 0) + exposure.valueBRL,
    );
  }

  const targetByClass = new Map<AssetClass, AllocationTarget>();
  for (const target of targets) {
    targetByClass.set(target.assetClass, target);
  }

  const classes = new Set<AssetClass>([
    ...targetByClass.keys(),
    ...valueByClass.keys(),
  ]);

  const rows: ClassAllocation[] = [];

  for (const assetClass of classes) {
    const currentValueBRL = round2(valueByClass.get(assetClass) ?? 0);
    const currentPercentage =
      totalBRL === 0 ? 0 : round4((currentValueBRL / totalBRL) * 100);

    // Classe sem política definida é tratada como alvo 0 e banda 0-0:
    // aparece explicitamente como sobrepeso em vez de ser ignorada.
    const target: AllocationTarget = targetByClass.get(assetClass) ?? {
      assetClass,
      targetPercentage: 0,
      minimumPercentage: 0,
      maximumPercentage: 0,
    };

    const targetValueBRL = (totalBRL * target.targetPercentage) / 100;
    const { status, severity } = classifyAllocation(currentPercentage, target);

    rows.push({
      assetClass,
      currentValueBRL,
      currentPercentage,
      targetPercentage: target.targetPercentage,
      minimumPercentage: target.minimumPercentage,
      maximumPercentage: target.maximumPercentage,
      gapPercentagePoints: round4(currentPercentage - target.targetPercentage),
      gapBRL: round2(currentValueBRL - targetValueBRL),
      status,
      severity,
    });
  }

  const order = new Map(ASSET_CLASSES.map((c, i) => [c, i]));
  return rows.sort(
    (a, b) => (order.get(a.assetClass) ?? 99) - (order.get(b.assetClass) ?? 99),
  );
}

/** Soma dos alvos. Deve ser 100 numa política coerente. */
export function targetsSum(targets: readonly AllocationTarget[]): number {
  return round4(targets.reduce((acc, t) => acc + t.targetPercentage, 0));
}

/** Erros estruturais da política, para exibir em Configurações. */
export function validatePolicy(targets: readonly AllocationTarget[]): string[] {
  const errors: string[] = [];
  const sum = targetsSum(targets);

  if (Math.abs(sum - 100) > 0.01) {
    errors.push(
      `A soma dos alvos é ${sum.toLocaleString("pt-BR")}%, deveria ser 100%.`,
    );
  }

  for (const target of targets) {
    if (target.minimumPercentage > target.targetPercentage) {
      errors.push(`${target.assetClass}: banda mínima acima do alvo.`);
    }
    if (target.maximumPercentage < target.targetPercentage) {
      errors.push(`${target.assetClass}: banda máxima abaixo do alvo.`);
    }
  }

  return errors;
}
