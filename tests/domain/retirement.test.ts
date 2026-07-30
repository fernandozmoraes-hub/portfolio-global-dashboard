import { describe, expect, it } from "vitest";
import { realBRL } from "@/domain/money/types";
import {
  ageAt,
  monthlyRealRate,
  projectByYear,
  projectRealPortfolio,
} from "@/domain/retirement/projection";
import {
  buildScenarios,
  evaluateWithdrawal,
  requiredCapital,
  sustainableMonthlyIncome,
} from "@/domain/retirement/withdrawal";
import {
  solveAgeWhenTargetReached,
  solveRequiredContribution,
  solveRequiredRealReturn,
} from "@/domain/retirement/solvers";

/**
 * Premissas do briefing, TODAS em reais reais (poder de compra de hoje):
 *   patrimônio  R$ 1.045.000
 *   aporte      R$ 10.000/mês, REAL e constante
 *   meta        R$ 25.000/mês aos 70
 *   horizonte   13 anos (57 -> 70)
 */
const PREMISSAS = {
  currentPortfolio: realBRL(1_045_000),
  monthlyContribution: realBRL(10_000),
  years: 13,
};

const META_MENSAL = realBRL(25_000);

describe("taxa real mensal equivalente", () => {
  it("compõe corretamente para 12 meses", () => {
    const rm = monthlyRealRate(0.05);
    expect(Math.pow(1 + rm, 12) - 1).toBeCloseTo(0.05, 10);
  });

  it("não é a divisão ingênua da taxa anual por 12", () => {
    expect(monthlyRealRate(0.05)).not.toBeCloseTo(0.05 / 12, 6);
  });

  it("trata taxa zero", () => {
    expect(monthlyRealRate(0)).toBe(0);
  });
});

describe("projeção de patrimônio em reais reais", () => {
  it("projeta o cenário base (5% real) aos 70 anos", () => {
    const projetado = projectRealPortfolio({
      ...PREMISSAS,
      expectedRealReturn: 0.05,
    }) as number;

    // Verificação independente feita à mão:
    //   1.045.000 × 1,05^13            = 1.970.503
    //   10.000 × [(1,05^13 − 1)/i]     = 2.173.839
    //                                    ---------
    //                                    4.144.342
    expect(projetado).toBeGreaterThan(4_144_000);
    expect(projetado).toBeLessThan(4_145_000);
  });

  it("projeta os três cenários em ordem crescente de retorno", () => {
    const conservador = projectRealPortfolio({ ...PREMISSAS, expectedRealReturn: 0.03 }) as number;
    const base = projectRealPortfolio({ ...PREMISSAS, expectedRealReturn: 0.05 }) as number;
    const otimista = projectRealPortfolio({ ...PREMISSAS, expectedRealReturn: 0.07 }) as number;

    expect(conservador).toBeGreaterThan(3_430_000);
    expect(conservador).toBeLessThan(3_440_000);
    expect(otimista).toBeGreaterThan(5_005_000);
    expect(otimista).toBeLessThan(5_020_000);

    expect(conservador).toBeLessThan(base);
    expect(base).toBeLessThan(otimista);
  });

  it("com retorno zero devolve apenas capital mais aportes", () => {
    const projetado = projectRealPortfolio({
      ...PREMISSAS,
      expectedRealReturn: 0,
    }) as number;

    // 1.045.000 + (10.000 × 156)
    expect(projetado).toBeCloseTo(1_045_000 + 1_560_000, 2);
  });

  it("horizonte zero devolve o patrimônio atual", () => {
    const projetado = projectRealPortfolio({
      ...PREMISSAS,
      expectedRealReturn: 0.05,
      years: 0,
    }) as number;
    expect(projetado).toBeCloseTo(1_045_000, 2);
  });

  it("gera a série anual de 57 a 70 anos", () => {
    const serie = projectByYear(
      { ...PREMISSAS, expectedRealReturn: 0.05 },
      57,
      2026,
    );

    expect(serie).toHaveLength(14); // 57..70 inclusive
    expect(serie[0]!.age).toBe(57);
    expect(serie[13]!.age).toBe(70);
    expect(serie[0]!.portfolio).toBeCloseTo(1_045_000, 2);

    // Patrimônio cresce monotonicamente
    for (let i = 1; i < serie.length; i += 1) {
      expect(serie[i]!.portfolio).toBeGreaterThan(serie[i - 1]!.portfolio);
    }

    // Decomposição fecha: patrimônio = inicial + aportes + ganho real
    const ultimo = serie[13]!;
    expect(
      1_045_000 + ultimo.cumulativeContributions + ultimo.cumulativeGrowth,
    ).toBeCloseTo(ultimo.portfolio, 1);
    expect(ultimo.cumulativeContributions).toBeCloseTo(1_560_000, 2);
  });
});

describe("capital de referência derivado da taxa de retirada", () => {
  it("R$ 7,5 mi é o capital da meta A 4%, não uma meta fixa", () => {
    expect(requiredCapital(META_MENSAL, 0.04) as number).toBeCloseTo(7_500_000, 2);
  });

  it("a mesma meta exige mais capital com retirada menor", () => {
    const a35 = requiredCapital(META_MENSAL, 0.035) as number;
    const a39 = requiredCapital(META_MENSAL, 0.039) as number;
    const a40 = requiredCapital(META_MENSAL, 0.04) as number;

    expect(a35).toBeCloseTo(8_571_428.57, 1);
    expect(a39).toBeCloseTo(7_692_307.69, 1);
    expect(a35).toBeGreaterThan(a39);
    expect(a39).toBeGreaterThan(a40);
  });

  it("renda sustentável é a operação inversa do capital necessário", () => {
    const capital = requiredCapital(META_MENSAL, 0.04);
    expect(sustainableMonthlyIncome(capital, 0.04) as number).toBeCloseTo(25_000, 2);
  });

  it("rejeita taxa de retirada não positiva", () => {
    expect(() => requiredCapital(META_MENSAL, 0)).toThrow();
    expect(() => requiredCapital(META_MENSAL, -0.01)).toThrow();
  });
});

describe("avaliação da meta contra a projeção", () => {
  it("mostra o déficit no cenário base a 4% de retirada", () => {
    const projetado = projectRealPortfolio({ ...PREMISSAS, expectedRealReturn: 0.05 });
    const r = evaluateWithdrawal(projetado, META_MENSAL, 0.04);

    // Renda projetada ≈ 4.144.342 × 4% / 12 ≈ R$ 13.814
    expect(r.projectedMonthlyIncome).toBeGreaterThan(13_800);
    expect(r.projectedMonthlyIncome).toBeLessThan(13_830);

    expect(r.targetMonthlyIncome).toBe(25_000);
    expect(r.incomeGap).toBeLessThan(0);
    expect(r.incomeGap).toBeCloseTo(r.projectedMonthlyIncome - 25_000, 2);
    expect(r.capitalGap).toBeLessThan(0);
    expect(r.meetsTarget).toBe(false);
    expect(r.coveragePercent).toBeGreaterThan(55);
    expect(r.coveragePercent).toBeLessThan(56);
  });

  it("reconhece meta atingida quando o capital é suficiente", () => {
    const r = evaluateWithdrawal(realBRL(7_500_000), META_MENSAL, 0.04);
    expect(r.meetsTarget).toBe(true);
    expect(r.incomeGap).toBeCloseTo(0, 2);
    expect(r.coveragePercent).toBeCloseTo(100, 2);
  });

  it("monta a matriz completa de cenários × taxas", () => {
    const cenarios = buildScenarios(PREMISSAS, META_MENSAL);

    expect(cenarios).toHaveLength(3);
    expect(cenarios.map((c) => c.label)).toEqual(["Conservador", "Base", "Otimista"]);

    for (const cenario of cenarios) {
      expect(cenario.outcomes).toHaveLength(3);
      // Capital necessário cresce quando a taxa de retirada cai
      const [t35, t39, t40] = cenario.outcomes;
      expect(t35!.requiredCapital).toBeGreaterThan(t39!.requiredCapital);
      expect(t39!.requiredCapital).toBeGreaterThan(t40!.requiredCapital);
      // O patrimônio projetado não depende da taxa de retirada
      expect(t35!.projectedPortfolio).toBe(t40!.projectedPortfolio);
    }
  });
});

describe("solvers reversos", () => {
  it("calcula o aporte mensal necessário para a meta", () => {
    const necessario = solveRequiredContribution({
      currentPortfolio: realBRL(1_045_000),
      targetCapital: requiredCapital(META_MENSAL, 0.04),
      expectedRealReturn: 0.05,
      years: 13,
    }) as number;

    // Verificação à mão: (7.500.000 − 1.970.503) / 217,384 ≈ R$ 25.437
    expect(necessario).toBeGreaterThan(25_400);
    expect(necessario).toBeLessThan(25_470);
  });

  it("devolve zero quando o capital atual já basta", () => {
    const necessario = solveRequiredContribution({
      currentPortfolio: realBRL(8_000_000),
      targetCapital: realBRL(7_500_000),
      expectedRealReturn: 0.05,
      years: 13,
    }) as number;
    expect(necessario).toBe(0);
  });

  it("o aporte encontrado realmente atinge a meta quando reaplicado", () => {
    const alvo = requiredCapital(META_MENSAL, 0.04);
    const necessario = solveRequiredContribution({
      currentPortfolio: realBRL(1_045_000),
      targetCapital: alvo,
      expectedRealReturn: 0.05,
      years: 13,
    });

    const projetado = projectRealPortfolio({
      currentPortfolio: realBRL(1_045_000),
      monthlyContribution: necessario,
      expectedRealReturn: 0.05,
      years: 13,
    }) as number;

    // O aporte é arredondado para centavos (não se aporta fração de centavo).
    // Meio centavo de diferença × fator de anuidade 217 => até ~R$ 1,10 de
    // desvio no capital final. Tolerância de R$ 2 cobre isso com folga.
    expect(Math.abs(projetado - (alvo as number))).toBeLessThan(2);
  });

  it("calcula o retorno real necessário mantido o aporte atual", () => {
    const taxa = solveRequiredRealReturn({
      ...PREMISSAS,
      targetCapital: requiredCapital(META_MENSAL, 0.04),
    });

    expect(taxa).not.toBeNull();
    // Precisa de bem mais que os 5% da premissa base
    expect(taxa!).toBeGreaterThan(0.05);
    expect(taxa!).toBeLessThan(0.20);

    // A taxa encontrada reproduz o alvo. Ela é arredondada para 6 casas
    // (numeric(8,6) no banco), o que introduz algumas dezenas de reais de
    // desvio no capital final — irrelevante para a decisão, mas não zero.
    const projetado = projectRealPortfolio({
      ...PREMISSAS,
      expectedRealReturn: taxa!,
    }) as number;
    expect(Math.abs(projetado - 7_500_000)).toBeLessThan(100);
  });

  it("devolve null quando a meta é inatingível por retorno", () => {
    const taxa = solveRequiredRealReturn({
      currentPortfolio: realBRL(1_000),
      monthlyContribution: realBRL(1),
      targetCapital: realBRL(999_000_000),
      years: 5,
    });
    expect(taxa).toBeNull();
  });

  it("calcula em que idade a meta seria atingida com o aporte atual", () => {
    const r = solveAgeWhenTargetReached({
      ...PREMISSAS,
      targetCapital: requiredCapital(META_MENSAL, 0.04),
      expectedRealReturn: 0.05,
      currentAge: 57,
    });

    expect(r).not.toBeNull();
    // Mantido o plano atual, a meta chega perto dos 78-79 anos, não aos 70
    expect(r!.age).toBeGreaterThan(78);
    expect(r!.age).toBeLessThan(79);
  });

  it("devolve null quando a meta não é atingida no horizonte máximo", () => {
    const r = solveAgeWhenTargetReached({
      currentPortfolio: realBRL(1_000),
      monthlyContribution: realBRL(10),
      targetCapital: realBRL(500_000_000),
      expectedRealReturn: 0.01,
      currentAge: 57,
    });
    expect(r).toBeNull();
  });
});

describe("idade a partir da data de nascimento", () => {
  it("calcula 57 anos para quem nasceu em 15/03/1969, em julho de 2026", () => {
    expect(ageAt(new Date("1969-03-15T00:00:00Z"), new Date("2026-07-30T00:00:00Z"))).toBe(57);
  });

  it("não conta o aniversário antes da data", () => {
    expect(ageAt(new Date("1969-08-15T00:00:00Z"), new Date("2026-07-30T00:00:00Z"))).toBe(56);
    expect(ageAt(new Date("1969-07-30T00:00:00Z"), new Date("2026-07-30T00:00:00Z"))).toBe(57);
    expect(ageAt(new Date("1969-07-31T00:00:00Z"), new Date("2026-07-30T00:00:00Z"))).toBe(56);
  });
});
