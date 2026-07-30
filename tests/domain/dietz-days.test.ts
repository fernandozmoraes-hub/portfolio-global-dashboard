import { describe, expect, it } from "vitest";
import {
  computePeriodReturn,
  daysBetween,
  flowWeight,
  modifiedDietz,
} from "@/domain/performance/dietz";

/**
 * CONVENÇÃO DE DIAS — blindagem contra off-by-one
 * ================================================
 *
 * O período é (start, end]. O peso é a fração do período em que o dinheiro
 * ficou investido: w = (T − d) / T.
 *
 * Estes testes fixam a convenção para que ela não possa mudar por acidente.
 */

describe("contagem de dias do calendário", () => {
  it("meses de 30 e 31 dias", () => {
    expect(daysBetween("2026-05-31", "2026-06-30")).toBe(30);
    expect(daysBetween("2026-06-30", "2026-07-31")).toBe(31);
    expect(daysBetween("2026-07-31", "2026-08-31")).toBe(31);
    expect(daysBetween("2026-08-31", "2026-09-30")).toBe(30);
  });

  it("fevereiro em ano comum tem 28 dias", () => {
    expect(daysBetween("2027-01-31", "2027-02-28")).toBe(28);
    expect(daysBetween("2026-01-31", "2026-02-28")).toBe(28);
  });

  it("fevereiro em ano bissexto tem 29 dias", () => {
    // 2028 é bissexto
    expect(daysBetween("2028-01-31", "2028-02-29")).toBe(29);
  });

  it("2100 não é bissexto (regra dos séculos)", () => {
    expect(daysBetween("2100-01-31", "2100-02-28")).toBe(28);
  });

  it("2000 foi bissexto (divisível por 400)", () => {
    expect(daysBetween("2000-01-31", "2000-02-29")).toBe(29);
  });

  it("atravessa a virada do ano", () => {
    expect(daysBetween("2026-12-31", "2027-01-31")).toBe(31);
  });

  it("o horário de verão não distorce a contagem", () => {
    // Em fusos com DST, outubro e fevereiro teriam dias de 23h/25h se a
    // contagem não estivesse ancorada em UTC.
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-02-01", "2026-03-01")).toBe(28);
  });
});

describe("peso do fluxo dentro do período", () => {
  const start = "2026-05-31";
  const end = "2026-06-30"; // 30 dias

  it("fluxo no INÍCIO do período tem peso 1", () => {
    expect(flowWeight(start, end, start)).toBe(1);
  });

  it("fluxo no FIM do período tem peso 0", () => {
    expect(flowWeight(start, end, end)).toBe(0);
  });

  it("fluxo intermediário tem peso proporcional", () => {
    // dia 15 de um período de 30 dias => 15 dias investido => 0,5
    expect(flowWeight(start, end, "2026-06-15")).toBeCloseTo(0.5, 10);
    // dia 10 => 20/30
    expect(flowWeight(start, end, "2026-06-10")).toBeCloseTo(20 / 30, 10);
    // dia 25 => 5/30
    expect(flowWeight(start, end, "2026-06-25")).toBeCloseTo(5 / 30, 10);
  });

  it("o peso decresce monotonicamente ao longo do período", () => {
    let anterior = 1.1;
    for (let dia = 1; dia <= 30; dia += 1) {
      const data = `2026-06-${String(dia).padStart(2, "0")}`;
      const peso = flowWeight(start, end, data);
      expect(peso).not.toBeNull();
      expect(peso!).toBeLessThan(anterior);
      expect(peso!).toBeGreaterThanOrEqual(0);
      expect(peso!).toBeLessThanOrEqual(1);
      anterior = peso!;
    }
  });

  it("o primeiro dia após o início não vale 1 nem 0", () => {
    // Blindagem contra off-by-one: 01/06 fica 29 dos 30 dias investido.
    expect(flowWeight(start, end, "2026-06-01")).toBeCloseTo(29 / 30, 10);
  });

  it("o dia anterior ao fim vale 1/T", () => {
    expect(flowWeight(start, end, "2026-06-29")).toBeCloseTo(1 / 30, 10);
  });

  it("fluxo fora do período devolve null", () => {
    expect(flowWeight(start, end, "2026-05-30")).toBeNull();
    expect(flowWeight(start, end, "2026-07-01")).toBeNull();
  });

  it("período inválido devolve null", () => {
    expect(flowWeight(end, start, "2026-06-15")).toBeNull();
    expect(flowWeight(start, start, start)).toBeNull();
  });
});

describe("peso em meses de comprimentos diferentes", () => {
  it("mês de 28 dias: metade é o dia 14", () => {
    expect(flowWeight("2027-01-31", "2027-02-28", "2027-02-14")).toBeCloseTo(
      0.5,
      10,
    );
  });

  it("mês de 29 dias (bissexto) desloca o meio", () => {
    const meio = flowWeight("2028-01-31", "2028-02-29", "2028-02-14");
    expect(meio).toBeCloseTo(15 / 29, 10);
    // O mesmo dia 14 pesa diferente em fevereiro comum e bissexto
    expect(meio).not.toBeCloseTo(0.5, 4);
  });

  it("mês de 31 dias: o dia 15 pesa mais que a metade", () => {
    const peso = flowWeight("2026-06-30", "2026-07-31", "2026-07-15");
    expect(peso).toBeCloseTo(16 / 31, 10);
    expect(peso!).toBeGreaterThan(0.5);
  });

  it("o mesmo dia do mês rende pesos distintos conforme o comprimento", () => {
    const dia10 = {
      fev28: flowWeight("2027-01-31", "2027-02-28", "2027-02-10"),
      jun30: flowWeight("2026-05-31", "2026-06-30", "2026-06-10"),
      jul31: flowWeight("2026-06-30", "2026-07-31", "2026-07-10"),
    };

    expect(dia10.fev28).toBeCloseTo(18 / 28, 10);
    expect(dia10.jun30).toBeCloseTo(20 / 30, 10);
    expect(dia10.jul31).toBeCloseTo(21 / 31, 10);
    // Quanto mais longo o mês, maior a fração restante após o dia 10
    expect(dia10.fev28!).toBeLessThan(dia10.jun30!);
    expect(dia10.jun30!).toBeLessThan(dia10.jul31!);
  });
});

describe("a convenção se propaga ao cálculo do retorno", () => {
  it("aporte no início do período entra inteiro no capital médio", () => {
    const r = modifiedDietz({
      start: "2026-05-31",
      end: "2026-06-30",
      startValue: 1_000_000,
      endValue: 1_060_000,
      flows: [{ date: "2026-05-31", type: "CONTRIBUTION", amountBRL: 50_000 }],
    });

    expect(r!.averageCapitalBRL).toBeCloseTo(1_050_000, 2);
    expect(r!.marketGainBRL).toBeCloseTo(10_000, 2);
  });

  it("aporte no último dia não entra no capital médio", () => {
    const r = modifiedDietz({
      start: "2026-05-31",
      end: "2026-06-30",
      startValue: 1_000_000,
      endValue: 1_060_000,
      flows: [{ date: "2026-06-30", type: "CONTRIBUTION", amountBRL: 50_000 }],
    });

    // Peso 0: o capital médio é só o inicial…
    expect(r!.averageCapitalBRL).toBeCloseTo(1_000_000, 2);
    // …mas o aporte continua descontado do ganho de mercado
    expect(r!.marketGainBRL).toBeCloseTo(10_000, 2);
    expect(r!.returnPercent).toBeCloseTo(1, 6);
  });

  it("fevereiro bissexto produz retorno diferente de fevereiro comum", () => {
    const base = {
      startValue: 1_000_000,
      endValue: 1_060_000,
      flows: [{ date: "2028-02-10", type: "CONTRIBUTION" as const, amountBRL: 50_000 }],
    };

    const bissexto = modifiedDietz({
      ...base,
      start: "2028-01-31",
      end: "2028-02-29",
    });
    const comum = modifiedDietz({
      startValue: 1_000_000,
      endValue: 1_060_000,
      flows: [{ date: "2027-02-10", type: "CONTRIBUTION", amountBRL: 50_000 }],
      start: "2027-01-31",
      end: "2027-02-28",
    });

    // 19/29 vs 18/28 — pesos distintos, logo capitais médios distintos
    expect(bissexto!.averageCapitalBRL).toBeCloseTo(
      1_000_000 + 50_000 * (19 / 29),
      2,
    );
    expect(comum!.averageCapitalBRL).toBeCloseTo(
      1_000_000 + 50_000 * (18 / 28),
      2,
    );
    expect(bissexto!.averageCapitalBRL).not.toBeCloseTo(
      comum!.averageCapitalBRL,
      2,
    );
  });

  it("dois aportes simétricos equivalem a um aporte no meio", () => {
    const simetricos = computePeriodReturn(
      {
        start: "2026-05-31",
        end: "2026-06-30",
        startValue: 1_000_000,
        endValue: 1_060_000,
        flows: [
          { date: "2026-06-05", type: "CONTRIBUTION", amountBRL: 25_000 },
          { date: "2026-06-25", type: "CONTRIBUTION", amountBRL: 25_000 },
        ],
      },
      50_000,
    );

    // (25/30)×25.000 + (5/30)×25.000 = 25.000 => igual a 0,5 × 50.000
    expect(simetricos!.averageCapitalBRL).toBeCloseTo(1_025_000, 2);
  });
});
