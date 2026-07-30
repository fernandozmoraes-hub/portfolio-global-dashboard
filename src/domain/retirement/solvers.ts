import { realBRL, round2, round4, round6, type RealBRL } from "@/domain/money/types";
import { monthlyRealRate, projectRealPortfolio } from "./projection";

/**
 * SOLVERS REVERSOS
 * =================
 *
 * A projeção direta responde "quanto vou ter?". Estes solvers respondem as
 * perguntas acionáveis quando existe déficit:
 *
 *   - quanto eu precisaria aportar por mês?
 *   - que retorno real eu precisaria obter?
 *   - com o aporte atual, em que idade eu chego lá?
 *
 * Todos em reais reais. Todos são diagnóstico determinístico, não conselho
 * de investimento — o retorno necessário, em particular, deve ser lido como
 * "o que seria preciso", não como "o que buscar".
 */

function annuityFactor(monthlyRate: number, months: number): number {
  if (Math.abs(monthlyRate) < 1e-12) return months;
  return (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
}

/**
 * Aporte mensal real necessário para atingir um capital-alvo.
 * Retorna 0 quando o capital atual já cresce sozinho até o alvo.
 */
export function solveRequiredContribution(params: {
  currentPortfolio: RealBRL;
  targetCapital: RealBRL;
  expectedRealReturn: number;
  years: number;
}): RealBRL {
  const { currentPortfolio, targetCapital, expectedRealReturn, years } = params;
  const months = Math.round(years * 12);
  if (months <= 0) return realBRL(0);

  const rate = monthlyRealRate(expectedRealReturn);
  const grown = (currentPortfolio as number) * Math.pow(1 + rate, months);
  const shortfall = (targetCapital as number) - grown;

  if (shortfall <= 0) return realBRL(0);

  return realBRL(round2(shortfall / annuityFactor(rate, months)));
}

/**
 * Retorno real anual necessário para atingir o capital-alvo, mantidos
 * patrimônio e aporte atuais.
 *
 * Resolvido por bissecção: a função de valor futuro é monótona crescente na
 * taxa, então a bissecção é estável e sempre converge no intervalo dado.
 *
 * Precisão de 6 casas, alinhada a numeric(8,6) da coluna do plano.
 *
 * @returns a taxa (0.073142 = 7,3142% a.a.) ou `null` se inatingível até 50% a.a.
 */
export function solveRequiredRealReturn(params: {
  currentPortfolio: RealBRL;
  monthlyContribution: RealBRL;
  targetCapital: RealBRL;
  years: number;
}): number | null {
  const { currentPortfolio, monthlyContribution, targetCapital, years } = params;
  const target = targetCapital as number;

  const valueAt = (rate: number): number =>
    projectRealPortfolio({
      currentPortfolio,
      monthlyContribution,
      expectedRealReturn: rate,
      years,
    }) as number;

  let low = -0.5;
  let high = 0.5;

  if (valueAt(high) < target) return null;
  if (valueAt(low) > target) return round6(low);

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (valueAt(mid) < target) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return round6((low + high) / 2);
}

export interface TargetReachedResult {
  /** Meses até atingir o capital-alvo. */
  readonly months: number;
  readonly years: number;
  /** Idade em que o alvo é atingido. */
  readonly age: number;
}

/**
 * Em que idade o capital-alvo é atingido, mantidos aporte e retorno atuais.
 *
 * @returns `null` se não for atingido dentro do horizonte máximo (60 anos).
 */
export function solveAgeWhenTargetReached(params: {
  currentPortfolio: RealBRL;
  monthlyContribution: RealBRL;
  targetCapital: RealBRL;
  expectedRealReturn: number;
  currentAge: number;
  maxYears?: number;
}): TargetReachedResult | null {
  const {
    currentPortfolio,
    monthlyContribution,
    targetCapital,
    expectedRealReturn,
    currentAge,
    maxYears = 60,
  } = params;

  const target = targetCapital as number;
  const rate = monthlyRealRate(expectedRealReturn);
  const maxMonths = Math.round(maxYears * 12);

  const p0 = currentPortfolio as number;
  const contribution = monthlyContribution as number;

  for (let months = 0; months <= maxMonths; months += 1) {
    const value =
      p0 * Math.pow(1 + rate, months) + contribution * annuityFactor(rate, months);

    if (value >= target) {
      return {
        months,
        years: round4(months / 12),
        age: round2(currentAge + months / 12),
      };
    }
  }

  return null;
}
