import { describe, expect, it } from "vitest";
import {
  computePeriodReturn,
  linkReturns,
  modifiedDietz,
  modifiedDietzFromNetFlow,
  realReturn,
} from "@/domain/performance/dietz";

/**
 * A REGRA QUE ESTE ARQUIVO PROTEGE
 * =================================
 * O aumento de patrimônio causado por APORTE não pode aparecer como
 * rentabilidade. E, sem dados suficientes, o sistema devolve null — nunca
 * inventa um retorno.
 */

describe("aporte não é rentabilidade", () => {
  it("carteira que só cresceu por aporte tem retorno zero", () => {
    const r = modifiedDietzFromNetFlow({
      startValue: 1_000_000,
      endValue: 1_010_000,
      netFlowBRL: 10_000,
    });

    expect(r).not.toBeNull();
    expect(r!.returnPercent).toBeCloseTo(0, 6);
    expect(r!.marketGainBRL).toBeCloseTo(0, 2);
    expect(r!.contributionsBRL).toBeCloseTo(10_000, 2);
  });

  it("separa ganho de mercado do aporte no fechamento do seed", () => {
    // maio 1.020.000 -> junho 1.045.000, com aporte de 10.000
    const r = modifiedDietzFromNetFlow({
      startValue: 1_020_000,
      endValue: 1_045_000,
      netFlowBRL: 10_000,
    });

    expect(r!.marketGainBRL).toBeCloseTo(15_000, 2);
    // 15.000 / (1.020.000 + 0,5×10.000) = 1,4634%
    expect(r!.returnPercent).toBeCloseTo(1.4634, 3);
  });

  it("carteira que caiu apesar do aporte mostra retorno negativo", () => {
    const r = modifiedDietzFromNetFlow({
      startValue: 1_000_000,
      endValue: 1_005_000,
      netFlowBRL: 20_000,
    });

    expect(r!.marketGainBRL).toBeCloseTo(-15_000, 2);
    expect(r!.returnPercent).toBeLessThan(0);
  });

  it("trata retirada como fluxo negativo, não como perda", () => {
    const r = modifiedDietzFromNetFlow({
      startValue: 1_000_000,
      endValue: 950_000,
      netFlowBRL: -50_000,
    });

    expect(r!.marketGainBRL).toBeCloseTo(0, 2);
    expect(r!.returnPercent).toBeCloseTo(0, 6);
    expect(r!.withdrawalsBRL).toBeCloseTo(50_000, 2);
  });
});

describe("Modified Dietz com fluxos datados", () => {
  it("pondera o fluxo pelo tempo em que ficou investido", () => {
    const r = modifiedDietz({
      start: "2026-06-01",
      end: "2026-07-01",
      startValue: 1_000_000,
      endValue: 1_060_000,
      flows: [{ date: "2026-06-16", type: "CONTRIBUTION", amountBRL: 50_000 }],
    });

    expect(r).not.toBeNull();
    expect(r!.usedDatedFlows).toBe(true);
    expect(r!.marketGainBRL).toBeCloseTo(10_000, 2);
    // Aporte no meio: capital médio ≈ 1.000.000 + 0,5×50.000 = 1.025.000
    expect(r!.averageCapitalBRL).toBeCloseTo(1_025_000, 0);
    expect(r!.returnPercent).toBeCloseTo(0.9756, 3);
  });

  it("aporte no início pesa mais que aporte no fim", () => {
    const base = {
      start: "2026-06-01",
      end: "2026-07-01",
      startValue: 1_000_000,
      endValue: 1_060_000,
    };

    const cedo = modifiedDietz({
      ...base,
      flows: [{ date: "2026-06-02", type: "CONTRIBUTION", amountBRL: 50_000 }],
    });
    const tarde = modifiedDietz({
      ...base,
      flows: [{ date: "2026-06-29", type: "CONTRIBUTION", amountBRL: 50_000 }],
    });

    // Mesmo ganho, mas mais capital empregado => retorno menor
    expect(cedo!.averageCapitalBRL).toBeGreaterThan(tarde!.averageCapitalBRL);
    expect(cedo!.returnPercent).toBeLessThan(tarde!.returnPercent);
  });

  it("soma múltiplos fluxos do período", () => {
    const r = modifiedDietz({
      start: "2026-06-01",
      end: "2026-07-01",
      startValue: 1_000_000,
      endValue: 1_100_000,
      flows: [
        { date: "2026-06-10", type: "CONTRIBUTION", amountBRL: 30_000 },
        { date: "2026-06-20", type: "CONTRIBUTION", amountBRL: 20_000 },
        { date: "2026-06-25", type: "WITHDRAWAL", amountBRL: 5_000 },
      ],
    });

    expect(r!.contributionsBRL).toBeCloseTo(50_000, 2);
    expect(r!.withdrawalsBRL).toBeCloseTo(5_000, 2);
    expect(r!.netFlowBRL).toBeCloseTo(45_000, 2);
    expect(r!.marketGainBRL).toBeCloseTo(55_000, 2);
  });

  it("sinaliza quando a datação do fluxo não é confiável", () => {
    const r = modifiedDietz({
      start: "2026-06-01",
      end: "2026-07-01",
      startValue: 1_000_000,
      endValue: 1_060_000,
      flows: [{ date: "2026-01-15", type: "CONTRIBUTION", amountBRL: 50_000 }],
    });

    expect(r!.usedDatedFlows).toBe(false);
  });
});

describe("recusa a inventar rentabilidade", () => {
  it("devolve null quando não há capital empregado", () => {
    expect(
      modifiedDietzFromNetFlow({ startValue: 0, endValue: 1_000, netFlowBRL: 0 }),
    ).toBeNull();
  });

  it("devolve null quando o período é inválido", () => {
    expect(
      modifiedDietz({
        start: "2026-07-01",
        end: "2026-06-01",
        startValue: 1_000_000,
        endValue: 1_060_000,
        flows: [],
      }),
    ).toBeNull();
  });

  it("devolve null para retorno real sem IPCA registrado", () => {
    expect(realReturn(1.5, null)).toBeNull();
  });

  it("devolve null ao encadear lista vazia de meses", () => {
    expect(linkReturns([])).toBeNull();
  });
});

describe("encadeamento geométrico (TWR do MVP)", () => {
  it("compõe os retornos mensais em vez de somá-los", () => {
    const acumulado = linkReturns([1, 1, 1])!;
    // 1,01³ − 1 = 3,0301%, não 3%
    expect(acumulado).toBeCloseTo(3.0301, 4);
    expect(acumulado).not.toBeCloseTo(3, 4);
  });

  it("um mês negativo reduz o acumulado", () => {
    expect(linkReturns([10, -10])!).toBeCloseTo(-1, 4);
  });

  it("meses zerados mantêm o acumulado", () => {
    expect(linkReturns([0, 0, 0])!).toBeCloseTo(0, 6);
  });
});

describe("retorno real", () => {
  it("desconta a inflação do retorno nominal", () => {
    // (1,015 / 1,005) − 1 = 0,995%
    expect(realReturn(1.5, 0.5)!).toBeCloseTo(0.995, 3);
  });

  it("retorno nominal abaixo da inflação vira retorno real negativo", () => {
    expect(realReturn(0.3, 0.5)!).toBeLessThan(0);
  });

  it("não é a subtração ingênua", () => {
    const real = realReturn(10, 5)!;
    expect(real).not.toBeCloseTo(5, 4);
    expect(real).toBeCloseTo(4.7619, 3);
  });
});

describe("ponderação temporal real dos fluxos", () => {
  const periodo = {
    start: "2026-05-31",
    end: "2026-06-30",
    startValue: 1_020_000,
    endValue: 1_045_000,
  };

  it("usa as datas reais quando os fluxos estão datados", () => {
    const r = computePeriodReturn(
      {
        ...periodo,
        flows: [{ date: "2026-06-10", type: "CONTRIBUTION", amountBRL: 10_000 }],
      },
      10_000,
    );

    expect(r!.method).toBe("DIETZ_DATADO");
    // Aporte no dia 10 de um período de 30 dias fica investido 20/30 = 2/3
    // => capital médio = 1.020.000 + 6.666,67 = 1.026.666,67
    expect(r!.averageCapitalBRL).toBeCloseTo(1_026_666.67, 0);
    expect(r!.marketGainBRL).toBeCloseTo(15_000, 2);
    expect(r!.returnPercent).toBeCloseTo(1.4610, 3);
  });

  it("o peso real difere do peso fixo de 0,5", () => {
    const datado = computePeriodReturn(
      {
        ...periodo,
        flows: [{ date: "2026-06-10", type: "CONTRIBUTION", amountBRL: 10_000 }],
      },
      10_000,
    );
    const meioPeriodo = computePeriodReturn({ ...periodo, flows: [] }, 10_000);

    expect(datado!.method).toBe("DIETZ_DATADO");
    expect(meioPeriodo!.method).toBe("DIETZ_MEIO_PERIODO");
    // Aporte antes do meio => mais capital empregado => retorno menor
    expect(datado!.averageCapitalBRL).toBeGreaterThan(
      meioPeriodo!.averageCapitalBRL,
    );
    expect(datado!.returnPercent).toBeLessThan(meioPeriodo!.returnPercent);
  });

  it("cai para o meio do período apenas na ausência de fluxos datados", () => {
    const r = computePeriodReturn({ ...periodo, flows: [] }, 10_000);
    expect(r!.method).toBe("DIETZ_MEIO_PERIODO");
    expect(r!.averageCapitalBRL).toBeCloseTo(1_025_000, 2);
  });

  it("vários aportes datados são ponderados individualmente", () => {
    const r = computePeriodReturn(
      {
        ...periodo,
        flows: [
          { date: "2026-06-05", type: "CONTRIBUTION", amountBRL: 5_000 },
          { date: "2026-06-25", type: "CONTRIBUTION", amountBRL: 5_000 },
        ],
      },
      10_000,
    );

    // pesos 25/30 e 5/30 => 4.166,67 + 833,33 = 5.000
    expect(r!.averageCapitalBRL).toBeCloseTo(1_025_000, 0);
    expect(r!.marketGainBRL).toBeCloseTo(15_000, 2);
  });

  it("devolve null quando o período não tem capital empregado", () => {
    expect(
      computePeriodReturn(
        { start: "2026-05-31", end: "2026-06-30", startValue: 0, endValue: 0, flows: [] },
        0,
      ),
    ).toBeNull();
  });
});
