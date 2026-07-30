import { describe, expect, it } from "vitest";
import {
  addReal,
  deflate,
  inflate,
  nominalBRL,
  realBRL,
  round2,
  scaleReal,
  subtractReal,
  unwrap,
} from "@/domain/money/types";
import { MissingFxRateError, rateToBRL, toBRL } from "@/domain/money/convert";
import {
  formatBRL,
  formatCurrency,
  formatDate,
  formatOrDash,
  formatPercent,
  formatPercentagePoints,
  NO_DATA,
} from "@/lib/format";

describe("reais reais vs nominais", () => {
  it("soma valores reais entre si", () => {
    expect(unwrap(addReal(realBRL(1000), realBRL(500)))).toBe(1500);
    expect(unwrap(subtractReal(realBRL(1000), realBRL(300)))).toBe(700);
    expect(unwrap(scaleReal(realBRL(1000), 1.5))).toBe(1500);
  });

  it("deflaciona um valor nominal futuro para reais de hoje", () => {
    // R$ 1.000 daqui a 10 anos com 4,5% de inflação
    const hoje = deflate(nominalBRL(1000), 0.045, 10);
    expect(unwrap(hoje)).toBeCloseTo(643.93, 2);
  });

  it("deflacionar e inflacionar são operações inversas", () => {
    const original = realBRL(1_045_000);
    const voltaAoPresente = deflate(inflate(original, 0.045, 13), 0.045, 13);
    expect(unwrap(voltaAoPresente)).toBeCloseTo(unwrap(original), 4);
  });

  it("mostra por que a distinção importa: R$ 25.000 nominais em 13 anos valem bem menos", () => {
    const nominal = nominalBRL(25_000);
    const emReaisDeHoje = deflate(nominal, 0.045, 13);
    expect(unwrap(emReaisDeHoje)).toBeLessThan(15_000);
  });
});

describe("arredondamento monetário", () => {
  it("corrige o erro binário clássico", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("arredonda para 2 casas", () => {
    expect(round2(1234.5678)).toBe(1234.57);
    expect(round2(1234.5649)).toBe(1234.56);
  });
});

describe("conversão cambial", () => {
  it("BRL sempre vale 1 e dispensa registro", () => {
    expect(rateToBRL("BRL", {})).toBe(1);
  });

  it("converte USD para BRL", () => {
    expect(toBRL(1000, "USD", { USD: 5.42 })).toBeCloseTo(5420, 2);
  });

  it("erra explicitamente em vez de assumir taxa 1", () => {
    expect(() => rateToBRL("USD", {})).toThrow(MissingFxRateError);
    expect(() => rateToBRL("USD", { USD: 0 })).toThrow(MissingFxRateError);
  });
});

describe("formatação pt-BR", () => {
  it("formata reais no padrão do briefing", () => {
    expect(formatBRL(1_045_000).replace(/ /g, " ")).toBe("R$ 1.045.000");
  });

  it("formata dólares no padrão do briefing", () => {
    expect(formatCurrency(39_410, "USD").replace(/ /g, " ")).toBe("US$ 39.410");
  });

  it("formata percentual com vírgula decimal", () => {
    expect(formatPercent(20.3)).toBe("20,3%");
    expect(formatPercent(46)).toBe("46,0%");
  });

  it("formata pontos percentuais com sinal", () => {
    expect(formatPercentagePoints(11)).toBe("+11,0 p.p.");
    expect(formatPercentagePoints(-9.7)).toBe("−9,7 p.p.");
    expect(formatPercentagePoints(0)).toBe("0,0 p.p.");
  });

  it("formata datas no padrão brasileiro", () => {
    expect(formatDate("2026-07-30")).toBe("30/07/2026");
  });

  it("exibe travessão para dado ausente em vez de inventar número", () => {
    expect(formatOrDash(null, formatBRL)).toBe(NO_DATA);
    expect(formatOrDash(undefined, formatBRL)).toBe(NO_DATA);
    expect(formatOrDash(Number.NaN, formatBRL)).toBe(NO_DATA);
    expect(formatOrDash(1000, formatBRL).replace(/ /g, " ")).toBe("R$ 1.000");
  });
});
