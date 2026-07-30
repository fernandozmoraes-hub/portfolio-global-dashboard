import { round2, round4 } from "@/domain/money/types";
import type { CashFlowType } from "@/domain/shared/types";

/**
 * PERFORMANCE — APORTE NÃO É RENTABILIDADE
 * =========================================
 *
 * O aumento de patrimônio causado por aporte jamais pode aparecer como
 * rentabilidade. Este módulo separa as duas coisas.
 *
 * MVP: Modified Dietz. Quando só existe o aporte líquido agregado do mês
 * (informado no fechamento), assume-se timing no meio do período — premissa
 * que a UI exibe explicitamente em tooltip.
 *
 * A assinatura já aceita fluxos datados individualmente, de modo que quando
 * `portfolio_cash_flows` estiver populado com datas reais o cálculo fica mais
 * preciso sem qualquer mudança de interface. XIRR/MWR virá depois sobre a
 * mesma fonte.
 *
 * REGRA INEGOCIÁVEL: sem dados suficientes, retorna `null`. Nunca estima.
 */

export interface CashFlow {
  /** Data do fluxo (ISO yyyy-mm-dd). */
  readonly date: string;
  readonly type: CashFlowType;
  /** Valor absoluto em BRL, sempre positivo. */
  readonly amountBRL: number;
}

export interface PeriodInput {
  /** Início do período (ISO yyyy-mm-dd). */
  readonly start: string;
  /** Fim do período (ISO yyyy-mm-dd). */
  readonly end: string;
  /** Patrimônio no início, em BRL. */
  readonly startValue: number;
  /** Patrimônio no fim, em BRL. */
  readonly endValue: number;
  readonly flows: readonly CashFlow[];
}

export interface PeriodReturn {
  /** Retorno do período em % (2.35 = 2,35%). */
  readonly returnPercent: number;
  /** Ganho/perda de mercado em BRL, já descontados os fluxos. */
  readonly marketGainBRL: number;
  /** Total aportado no período. */
  readonly contributionsBRL: number;
  /** Total retirado no período. */
  readonly withdrawalsBRL: number;
  /** Fluxo líquido (aportes − retiradas). */
  readonly netFlowBRL: number;
  /** Capital médio empregado (denominador do Modified Dietz). */
  readonly averageCapitalBRL: number;
  /** True quando os fluxos vieram com data real; false se assumiu meio do mês. */
  readonly usedDatedFlows: boolean;
}

/** Sinal do fluxo: aporte entra positivo, retirada negativa. */
function signedAmount(flow: CashFlow): number {
  return flow.type === "CONTRIBUTION" ? flow.amountBRL : -flow.amountBRL;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return (b - a) / 86_400_000;
}

/**
 * Modified Dietz.
 *
 *   R = (V₁ − V₀ − F) / (V₀ + Σ wᵢ·Fᵢ)
 *
 * onde wᵢ = fração do período restante após o fluxo i.
 *
 * @returns `null` se o capital médio empregado for zero ou negativo — situação
 *          em que nenhum retorno é matematicamente definível.
 */
export function modifiedDietz(period: PeriodInput): PeriodReturn | null {
  const totalDays = daysBetween(period.start, period.end);
  if (totalDays <= 0) return null;

  let contributions = 0;
  let withdrawals = 0;
  let weightedFlow = 0;
  let netFlow = 0;
  let usedDatedFlows = true;

  for (const flow of period.flows) {
    const signed = signedAmount(flow);
    netFlow += signed;

    if (flow.type === "CONTRIBUTION") {
      contributions += flow.amountBRL;
    } else {
      withdrawals += flow.amountBRL;
    }

    const elapsed = daysBetween(period.start, flow.date);
    // Fluxo fora do período é tratado como meio do período em vez de
    // distorcer o peso — e sinaliza que a datação não é confiável.
    let weight: number;
    if (elapsed < 0 || elapsed > totalDays) {
      weight = 0.5;
      usedDatedFlows = false;
    } else {
      weight = (totalDays - elapsed) / totalDays;
    }

    weightedFlow += weight * signed;
  }

  const averageCapital = period.startValue + weightedFlow;
  if (averageCapital <= 0) return null;

  const marketGain = period.endValue - period.startValue - netFlow;

  return {
    returnPercent: round4((marketGain / averageCapital) * 100),
    marketGainBRL: round2(marketGain),
    contributionsBRL: round2(contributions),
    withdrawalsBRL: round2(withdrawals),
    netFlowBRL: round2(netFlow),
    averageCapitalBRL: round2(averageCapital),
    usedDatedFlows,
  };
}

/**
 * Modified Dietz quando só se conhece o fluxo líquido agregado do mês.
 * Assume o fluxo no meio do período (peso 0,5) — a premissa do MVP.
 */
export function modifiedDietzFromNetFlow(params: {
  startValue: number;
  endValue: number;
  netFlowBRL: number;
}): PeriodReturn | null {
  const { startValue, endValue, netFlowBRL } = params;

  const averageCapital = startValue + 0.5 * netFlowBRL;
  if (averageCapital <= 0) return null;

  const marketGain = endValue - startValue - netFlowBRL;

  return {
    returnPercent: round4((marketGain / averageCapital) * 100),
    marketGainBRL: round2(marketGain),
    contributionsBRL: netFlowBRL > 0 ? round2(netFlowBRL) : 0,
    withdrawalsBRL: netFlowBRL < 0 ? round2(-netFlowBRL) : 0,
    netFlowBRL: round2(netFlowBRL),
    averageCapitalBRL: round2(averageCapital),
    usedDatedFlows: false,
  };
}

/** Como o retorno do período foi apurado. A UI precisa dizer isso ao usuário. */
export type ReturnMethod = "DIETZ_DATADO" | "DIETZ_MEIO_PERIODO";

export interface PeriodReturnResult extends PeriodReturn {
  readonly method: ReturnMethod;
}

/**
 * Apura o retorno do período preferindo SEMPRE os fluxos datados.
 *
 * Regra: se existe ao menos um fluxo com data real no período, o Modified
 * Dietz pondera cada um pelo tempo em que ficou investido. O peso fixo de 0,5
 * é fallback exclusivo para o caso em que só se conhece o agregado do mês —
 * e, quando usado, a UI é obrigada a informá-lo.
 *
 * @param netFlowFallback fluxo líquido agregado, usado só na ausência de datas
 */
export function computePeriodReturn(
  period: PeriodInput,
  netFlowFallback: number,
): PeriodReturnResult | null {
  if (period.flows.length > 0) {
    const result = modifiedDietz(period);
    if (result === null) return null;
    return {
      ...result,
      method: result.usedDatedFlows ? "DIETZ_DATADO" : "DIETZ_MEIO_PERIODO",
    };
  }

  const fallback = modifiedDietzFromNetFlow({
    startValue: period.startValue,
    endValue: period.endValue,
    netFlowBRL: netFlowFallback,
  });

  if (fallback === null) return null;
  return { ...fallback, method: "DIETZ_MEIO_PERIODO" };
}

/**
 * Encadeamento geométrico de retornos mensais — o TWR do MVP.
 *
 *   TWR = [(1+r₁)·(1+r₂)·…·(1+rₙ)] − 1
 *
 * Neutraliza o efeito de aportes, que é justamente o objetivo.
 *
 * @param monthlyReturnsPercent retornos mensais em % (2.35 = 2,35%)
 * @returns retorno acumulado em %, ou `null` se a lista estiver vazia
 */
export function linkReturns(
  monthlyReturnsPercent: readonly number[],
): number | null {
  if (monthlyReturnsPercent.length === 0) return null;

  const compounded = monthlyReturnsPercent.reduce(
    (acc, r) => acc * (1 + r / 100),
    1,
  );

  return round4((compounded - 1) * 100);
}

/**
 * Retorno real a partir do nominal e da inflação do período.
 *
 *   r_real = (1 + r_nominal)/(1 + inflação) − 1
 *
 * @returns `null` quando a inflação do período não está registrada — o sistema
 *          prefere exibir "—" a inventar um retorno real.
 */
export function realReturn(
  nominalReturnPercent: number,
  inflationPercent: number | null,
): number | null {
  if (inflationPercent === null) return null;

  const real =
    (1 + nominalReturnPercent / 100) / (1 + inflationPercent / 100) - 1;

  return round4(real * 100);
}
