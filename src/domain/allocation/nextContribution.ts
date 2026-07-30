import type { AssetClass } from "@/domain/shared/types";
import { round2, round4 } from "@/domain/money/types";
import type { ClassAllocation } from "./gap";

/**
 * DESTINO SUGERIDO DO PRÓXIMO APORTE
 * ===================================
 *
 * ESCOPO DELIBERADAMENTE LIMITADO: este algoritmo identifica qual CLASSE está
 * mais subalocada frente à política. Ele NÃO escolhe ativos, NÃO recomenda
 * papéis e NÃO opina sobre mercado. A escolha do ativo é decisão do gestor.
 *
 * Prioridade:
 *   1. Classes ABAIXO DA BANDA MÍNIMA (violação de política) — sempre primeiro.
 *   2. Classes abaixo do alvo, porém dentro da banda.
 *
 * Dentro de cada nível, ordena pelo maior gap em pontos percentuais.
 * O rateio é proporcional ao gap em R$ e nunca ultrapassa o alvo da classe.
 */

export interface ContributionSuggestion {
  readonly assetClass: AssetClass;
  /** 1 = fora da banda (urgente), 2 = abaixo do alvo. */
  readonly priority: 1 | 2;
  /** Sempre negativo: quanto falta em pontos percentuais. */
  readonly gapPercentagePoints: number;
  /** Sempre positivo: quanto falta em R$ para atingir o alvo. */
  readonly deficitBRL: number;
  /** Parcela sugerida do aporte para esta classe. */
  readonly suggestedAmountBRL: number;
  /** Participação da parcela no aporte total (0-100). */
  readonly suggestedSharePercent: number;
}

export interface ContributionPlan {
  readonly contributionBRL: number;
  readonly suggestions: readonly ContributionSuggestion[];
  /** Sobra quando o aporte excede o total necessário para zerar os gaps. */
  readonly unallocatedBRL: number;
  /** Texto pronto para exibição, já em pt-BR. */
  readonly summary: string;
}

/**
 * Distribui um aporte entre as classes subalocadas.
 *
 * @param allocations situação atual das classes (saída de `computeAllocation`)
 * @param contributionBRL valor do aporte a distribuir
 */
export function suggestNextContribution(
  allocations: readonly ClassAllocation[],
  contributionBRL: number,
): ContributionPlan {
  if (contributionBRL <= 0) {
    return {
      contributionBRL: 0,
      suggestions: [],
      unallocatedBRL: 0,
      summary: "Informe um valor de aporte para ver a sugestão de destino.",
    };
  }

  const underweight = allocations
    .filter((row) => row.gapBRL < 0)
    .map((row) => ({
      row,
      priority: (row.currentPercentage < row.minimumPercentage ? 1 : 2) as 1 | 2,
      deficitBRL: Math.abs(row.gapBRL),
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.row.gapPercentagePoints - b.row.gapPercentagePoints;
    });

  if (underweight.length === 0) {
    return {
      contributionBRL,
      suggestions: [],
      unallocatedBRL: round2(contributionBRL),
      summary:
        "Nenhuma classe está abaixo do alvo. A carteira está aderente à política — " +
        "o aporte pode seguir o critério do gestor.",
    };
  }

  // Rateio proporcional ao déficit, respeitando a ordem de prioridade:
  // classes fora da banda são atendidas integralmente antes das demais.
  const suggestions: ContributionSuggestion[] = [];
  let remaining = contributionBRL;

  const criticalDeficit = underweight
    .filter((item) => item.priority === 1)
    .reduce((acc, item) => acc + item.deficitBRL, 0);

  const useCriticalFirst = criticalDeficit > 0 && criticalDeficit <= remaining;
  const pool = useCriticalFirst
    ? underweight.filter((item) => item.priority === 1)
    : underweight;
  const poolDeficit = pool.reduce((acc, item) => acc + item.deficitBRL, 0);
  const distributable = Math.min(remaining, poolDeficit);

  for (const item of pool) {
    const share = poolDeficit === 0 ? 0 : item.deficitBRL / poolDeficit;
    const amount = round2(distributable * share);
    remaining -= amount;
    suggestions.push({
      assetClass: item.row.assetClass,
      priority: item.priority,
      gapPercentagePoints: item.row.gapPercentagePoints,
      deficitBRL: round2(item.deficitBRL),
      suggestedAmountBRL: amount,
      suggestedSharePercent: round4((amount / contributionBRL) * 100),
    });
  }

  // Se as classes críticas foram atendidas e ainda há saldo, distribui o
  // restante entre as demais classes abaixo do alvo.
  if (useCriticalFirst && remaining > 0.01) {
    const rest = underweight.filter((item) => item.priority === 2);
    const restDeficit = rest.reduce((acc, item) => acc + item.deficitBRL, 0);
    const restDistributable = Math.min(remaining, restDeficit);

    for (const item of rest) {
      const share = restDeficit === 0 ? 0 : item.deficitBRL / restDeficit;
      const amount = round2(restDistributable * share);
      remaining -= amount;
      suggestions.push({
        assetClass: item.row.assetClass,
        priority: item.priority,
        gapPercentagePoints: item.row.gapPercentagePoints,
        deficitBRL: round2(item.deficitBRL),
        suggestedAmountBRL: amount,
        suggestedSharePercent: round4((amount / contributionBRL) * 100),
      });
    }
  }

  return {
    contributionBRL: round2(contributionBRL),
    suggestions,
    unallocatedBRL: round2(Math.max(0, remaining)),
    summary: buildSummary(suggestions),
  };
}

function buildSummary(
  suggestions: readonly ContributionSuggestion[],
): string {
  const top = suggestions
    .filter((s) => s.suggestedAmountBRL > 0)
    .slice(0, 2)
    .map((s) => CLASS_TEXT[s.assetClass]);

  if (top.length === 0) {
    return "Nenhuma classe está abaixo do alvo.";
  }
  if (top.length === 1) {
    return `Priorizar novos aportes em ${top[0]}.`;
  }
  return `Priorizar novos aportes em ${top[0]} e ${top[1]}.`;
}

const CLASS_TEXT: Record<AssetClass, string> = {
  RF_BRASIL: "Renda Fixa Brasil",
  ACOES_BRASIL: "Ações Brasil",
  ACOES_ETF_EXTERIOR: "Ações Internacionais",
  RF_CAIXA_EXTERIOR: "Renda Fixa/Caixa USD",
  FII_IMOBILIARIO: "FIIs",
  MULTIMERCADO_ALTERNATIVO: "Multimercados",
  CAIXA_BR: "Caixa BR",
};
