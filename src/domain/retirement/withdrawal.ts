import { realBRL, round2, round4, type RealBRL } from "@/domain/money/types";
import {
  projectRealPortfolio,
  type RetirementAssumptions,
} from "./projection";

/**
 * META E TAXAS DE RETIRADA
 * =========================
 *
 * A META PRINCIPAL é de renda: R$ 25.000/mês em reais de hoje aos 70 anos.
 *
 * O capital necessário NÃO é um número fixo — ele é derivado da taxa de
 * retirada adotada. R$ 7,5 milhões é apenas o capital correspondente à meta
 * usando 4% de retirada; a 3,5% o mesmo objetivo exige ~R$ 8,6 milhões.
 * Por isso o sistema calcula o capital de referência dinamicamente para cada
 * taxa, e nunca trata um único valor como "a meta oficial".
 */

/** Taxas de retirada anual avaliadas por padrão. */
export const DEFAULT_WITHDRAWAL_RATES = [0.035, 0.039, 0.04] as const;

/**
 * Capital necessário para sustentar uma renda mensal real perpetuamente,
 * dada uma taxa de retirada anual.
 *
 *   capital = renda_mensal × 12 ÷ taxa
 */
export function requiredCapital(
  monthlyIncomeTarget: RealBRL,
  withdrawalRate: number,
): RealBRL {
  if (withdrawalRate <= 0) {
    throw new Error("Taxa de retirada deve ser maior que zero.");
  }
  return realBRL(round2(((monthlyIncomeTarget as number) * 12) / withdrawalRate));
}

/** Renda mensal real sustentável por um capital, dada a taxa de retirada. */
export function sustainableMonthlyIncome(
  capital: RealBRL,
  withdrawalRate: number,
): RealBRL {
  return realBRL(round2(((capital as number) * withdrawalRate) / 12));
}

/** Resultado da projeção para uma combinação (cenário de retorno × taxa). */
export interface WithdrawalOutcome {
  /** Taxa de retirada anual (0.04 = 4%). */
  readonly withdrawalRate: number;
  /** Capital necessário para a meta, nesta taxa. */
  readonly requiredCapital: number;
  /** Patrimônio projetado aos 70, em reais de hoje. */
  readonly projectedPortfolio: number;
  /** Renda mensal real que o patrimônio projetado sustenta. */
  readonly projectedMonthlyIncome: number;
  /** Meta mensal real. */
  readonly targetMonthlyIncome: number;
  /** Renda projetada − meta. Negativo = déficit. */
  readonly incomeGap: number;
  /** Patrimônio projetado − capital necessário. Negativo = déficit. */
  readonly capitalGap: number;
  /** Percentual da meta coberto pela projeção (0-100+). */
  readonly coveragePercent: number;
  readonly meetsTarget: boolean;
}

/** Um cenário de retorno real, com seus desdobramentos por taxa de retirada. */
export interface RetirementScenario {
  readonly label: string;
  readonly expectedRealReturn: number;
  readonly projectedPortfolio: number;
  readonly outcomes: readonly WithdrawalOutcome[];
}

export interface ScenarioDefinition {
  readonly label: string;
  readonly expectedRealReturn: number;
}

/** Cenários padrão do briefing. */
export const DEFAULT_SCENARIOS: readonly ScenarioDefinition[] = [
  { label: "Conservador", expectedRealReturn: 0.03 },
  { label: "Base", expectedRealReturn: 0.05 },
  { label: "Otimista", expectedRealReturn: 0.07 },
];

/**
 * Avalia uma combinação de patrimônio projetado × taxa de retirada
 * contra a meta de renda.
 */
export function evaluateWithdrawal(
  projectedPortfolio: RealBRL,
  monthlyIncomeTarget: RealBRL,
  withdrawalRate: number,
): WithdrawalOutcome {
  const needed = requiredCapital(monthlyIncomeTarget, withdrawalRate) as number;
  const income = sustainableMonthlyIncome(
    projectedPortfolio,
    withdrawalRate,
  ) as number;
  const target = monthlyIncomeTarget as number;

  return {
    withdrawalRate,
    requiredCapital: needed,
    projectedPortfolio: round2(projectedPortfolio as number),
    projectedMonthlyIncome: income,
    targetMonthlyIncome: round2(target),
    incomeGap: round2(income - target),
    capitalGap: round2((projectedPortfolio as number) - needed),
    coveragePercent: target === 0 ? 0 : round4((income / target) * 100),
    meetsTarget: income + 0.005 >= target,
  };
}

/**
 * Monta a matriz completa de cenários × taxas de retirada que alimenta a
 * página Aposentadoria 70.
 */
export function buildScenarios(
  assumptions: Omit<RetirementAssumptions, "expectedRealReturn">,
  monthlyIncomeTarget: RealBRL,
  scenarios: readonly ScenarioDefinition[] = DEFAULT_SCENARIOS,
  withdrawalRates: readonly number[] = DEFAULT_WITHDRAWAL_RATES,
): RetirementScenario[] {
  return scenarios.map((scenario) => {
    const projected = projectRealPortfolio({
      ...assumptions,
      expectedRealReturn: scenario.expectedRealReturn,
    });

    return {
      label: scenario.label,
      expectedRealReturn: scenario.expectedRealReturn,
      projectedPortfolio: round2(projected as number),
      outcomes: withdrawalRates.map((rate) =>
        evaluateWithdrawal(projected, monthlyIncomeTarget, rate),
      ),
    };
  });
}
