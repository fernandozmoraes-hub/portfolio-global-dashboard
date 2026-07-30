import { realBRL, round2, type RealBRL } from "@/domain/money/types";

/**
 * PROJEÇÃO DE APOSENTADORIA — TUDO EM REAIS REAIS
 * ================================================
 *
 * Todo este módulo opera em poder de compra de HOJE:
 *
 *   - o patrimônio inicial está em reais de hoje;
 *   - o aporte mensal de R$ 10.000 é REAL e permanece constante em poder de
 *     compra (na prática significa reajustá-lo pela inflação a cada ano);
 *   - o retorno esperado é REAL (já líquido de inflação);
 *   - a renda projetada aos 70 sai em reais de hoje, comparável direto com a
 *     meta de R$ 25.000/mês.
 *
 * Nenhum valor nominal entra ou sai daqui. Os tipos `RealBRL` impedem que um
 * valor nominal seja misturado por engano.
 *
 * ⚠️ São SIMULAÇÕES determinísticas sobre premissas do usuário, não previsão
 * nem garantia de retorno.
 */

export interface RetirementAssumptions {
  /** Patrimônio financeiro atual (não inclui imóvel). */
  readonly currentPortfolio: RealBRL;
  /** Aporte mensal em poder de compra de hoje. */
  readonly monthlyContribution: RealBRL;
  /** Retorno real anual esperado (0.05 = 5% a.a. acima da inflação). */
  readonly expectedRealReturn: number;
  /** Anos até a aposentadoria. */
  readonly years: number;
}

/** Converte taxa real anual em taxa real mensal equivalente (composta). */
export function monthlyRealRate(annualRealReturn: number): number {
  return Math.pow(1 + annualRealReturn, 1 / 12) - 1;
}

/**
 * Fator de valor futuro de uma série uniforme de aportes mensais.
 * Trata o caso de taxa zero, onde a fórmula fechada dividiria por zero.
 */
function annuityFactor(monthlyRate: number, months: number): number {
  if (Math.abs(monthlyRate) < 1e-12) return months;
  return (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
}

/**
 * Patrimônio projetado ao final do período, em reais de hoje.
 *
 *   FV = P₀·(1+i)^n + A·[((1+i)^n − 1)/i]
 *
 * com i = taxa real mensal e n = meses. Aportes considerados ao final de cada
 * mês (convenção postecipada).
 */
export function projectRealPortfolio(
  assumptions: RetirementAssumptions,
): RealBRL {
  const { currentPortfolio, monthlyContribution, expectedRealReturn, years } =
    assumptions;

  const months = Math.round(years * 12);
  if (months <= 0) return currentPortfolio;

  const rate = monthlyRealRate(expectedRealReturn);
  const growth = Math.pow(1 + rate, months);

  const fromCapital = (currentPortfolio as number) * growth;
  const fromContributions =
    (monthlyContribution as number) * annuityFactor(rate, months);

  return realBRL(round2(fromCapital + fromContributions));
}

export interface ProjectionPoint {
  readonly age: number;
  readonly year: number;
  /** Patrimônio projetado em reais de hoje. */
  readonly portfolio: number;
  /** Aportes acumulados até aqui, em reais de hoje. */
  readonly cumulativeContributions: number;
  /** Ganho real acumulado (patrimônio − capital inicial − aportes). */
  readonly cumulativeGrowth: number;
}

/**
 * Série anual da projeção, da idade atual até a de aposentadoria.
 * Alimenta o gráfico da página Aposentadoria 70.
 */
export function projectByYear(
  assumptions: RetirementAssumptions,
  currentAge: number,
  startYear: number,
): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];
  const totalYears = Math.max(0, Math.round(assumptions.years));

  for (let elapsed = 0; elapsed <= totalYears; elapsed += 1) {
    const portfolio = projectRealPortfolio({
      ...assumptions,
      years: elapsed,
    }) as number;

    const contributions = round2(
      (assumptions.monthlyContribution as number) * elapsed * 12,
    );

    points.push({
      age: currentAge + elapsed,
      year: startYear + elapsed,
      portfolio: round2(portfolio),
      cumulativeContributions: contributions,
      cumulativeGrowth: round2(
        portfolio - (assumptions.currentPortfolio as number) - contributions,
      ),
    });
  }

  return points;
}

/** Idade a partir da data de nascimento, em anos completos. */
export function ageAt(birthDate: Date, reference: Date): number {
  let age = reference.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = reference.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}
