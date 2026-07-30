import { describe, expect, it } from "vitest";
import {
  resolveCurrentPortfolio,
  type DatedPosition,
} from "@/domain/positions/current";
import {
  buildNav,
  selectQuantitiesAsOf,
  type QuantityToPrice,
} from "@/domain/positions/reprice";

/**
 * POSIÇÃO CORRENTE vs NAV DE FECHAMENTO
 * ======================================
 * Semânticas deliberadamente diferentes:
 *   - corrente aceita fontes com datas distintas (é o que se tem hoje);
 *   - fechamento exige data e câmbio únicos (consistência temporal).
 */

function p(
  accountId: string,
  assetId: string,
  referenceDate: string,
  valor: number,
  overrides: Partial<DatedPosition> = {},
): DatedPosition {
  return {
    accountId,
    accountName: `Conta ${accountId}`,
    brokerId: `broker-${accountId}`,
    brokerName: `Corretora ${accountId}`,
    assetId,
    ticker: assetId.toUpperCase(),
    assetName: assetId,
    assetClass: "ACOES_BRASIL",
    riskBucket: "CORE",
    currency: "BRL",
    country: "BR",
    sector: null,
    quantity: 1,
    averageCost: valor,
    currentPrice: valor,
    referenceDate,
    ...overrides,
  };
}

describe("carteira corrente usa a última data DE CADA CONTA", () => {
  it("não descarta contas que fecharam em outra data", () => {
    // XP atualizada em 31/07, Avenue só em 28/07.
    // Um corte global em 31/07 zeraria a Avenue.
    const positions = [
      p("xp", "itub4", "2026-07-31", 100_000),
      p("avenue", "googl", "2026-07-28", 60_000),
    ];

    const current = resolveCurrentPortfolio(positions, "2026-07-31", {});

    expect(current.positions).toHaveLength(2);
    const total = current.sources.reduce((acc, s) => acc + s.valueBRL, 0);
    expect(total).toBeCloseTo(160_000, 2);
  });

  it("descarta a posição HISTÓRICA da mesma conta", () => {
    const positions = [
      p("xp", "itub4", "2026-06-30", 90_000),
      p("xp", "itub4", "2026-07-31", 100_000),
    ];

    const current = resolveCurrentPortfolio(positions, "2026-07-31", {});

    expect(current.positions).toHaveLength(1);
    expect(current.positions[0]!.currentPrice).toBe(100_000);
  });

  it("cada conta é resolvida de forma independente", () => {
    const positions = [
      p("xp", "a", "2026-06-30", 10_000),
      p("xp", "a", "2026-07-31", 12_000),
      p("avenue", "b", "2026-05-31", 20_000),
      p("avenue", "b", "2026-07-28", 25_000),
    ];

    const current = resolveCurrentPortfolio(positions, "2026-07-31", {});

    expect(current.positions).toHaveLength(2);
    expect(current.positions.map((x) => x.currentPrice).sort((a, b) => a - b))
      .toEqual([12_000, 25_000]);
  });

  it("expõe a data e a defasagem de cada fonte", () => {
    const positions = [
      p("xp", "a", "2026-07-31", 100_000),
      p("avenue", "b", "2026-07-28", 60_000),
    ];

    const current = resolveCurrentPortfolio(positions, "2026-07-31", {});
    const avenue = current.sources.find((s) => s.accountId === "avenue")!;
    const xp = current.sources.find((s) => s.accountId === "xp")!;

    expect(xp.ageDays).toBe(0);
    expect(avenue.ageDays).toBe(3);
    expect(avenue.referenceDate).toBe("2026-07-28");
    expect(avenue.positionCount).toBe(1);
  });

  it("sinaliza quando as fontes têm datas diferentes", () => {
    const mistas = resolveCurrentPortfolio(
      [p("xp", "a", "2026-07-31", 1), p("avenue", "b", "2026-07-28", 1)],
      "2026-07-31",
      {},
    );
    const iguais = resolveCurrentPortfolio(
      [p("xp", "a", "2026-07-31", 1), p("avenue", "b", "2026-07-31", 1)],
      "2026-07-31",
      {},
    );

    expect(mistas.hasMixedDates).toBe(true);
    expect(iguais.hasMixedDates).toBe(false);
    expect(mistas.oldestDate).toBe("2026-07-28");
    expect(mistas.newestDate).toBe("2026-07-31");
  });

  it("marca fonte defasada além do limite tolerado", () => {
    const current = resolveCurrentPortfolio(
      [
        p("xp", "a", "2026-07-31", 1),
        p("antiga", "b", "2026-05-31", 1),
      ],
      "2026-07-31",
      {},
      35,
    );

    expect(current.hasStaleSources).toBe(true);
    expect(current.sources.find((s) => s.accountId === "antiga")!.isStale).toBe(true);
    expect(current.sources.find((s) => s.accountId === "xp")!.isStale).toBe(false);
  });

  it("ordena as fontes da mais antiga para a mais recente", () => {
    const current = resolveCurrentPortfolio(
      [
        p("c", "x", "2026-07-31", 1),
        p("a", "y", "2026-05-31", 1),
        p("b", "z", "2026-06-30", 1),
      ],
      "2026-07-31",
      {},
    );
    expect(current.sources.map((s) => s.referenceDate)).toEqual([
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
    ]);
  });

  it("valora fontes em moeda estrangeira com o câmbio informado", () => {
    const current = resolveCurrentPortfolio(
      [p("avenue", "googl", "2026-07-31", 10_000, { currency: "USD" })],
      "2026-07-31",
      { USD: 5.42 },
    );
    expect(current.sources[0]!.valueBRL).toBeCloseTo(54_200, 2);
  });

  it("carteira sem posições devolve estrutura vazia e coerente", () => {
    const current = resolveCurrentPortfolio([], "2026-07-31", {});
    expect(current.positions).toEqual([]);
    expect(current.sources).toEqual([]);
    expect(current.oldestDate).toBeNull();
    expect(current.hasMixedDates).toBe(false);
  });
});

describe("NAV de fechamento é temporalmente consistente", () => {
  function q(
    accountId: string,
    assetId: string,
    quantity: number,
    quantityAsOf: string,
    currency: "BRL" | "USD" = "BRL",
  ): QuantityToPrice {
    return {
      accountId,
      accountName: accountId,
      brokerName: accountId,
      assetId,
      ticker: assetId.toUpperCase(),
      currency,
      quantity,
      quantityAsOf,
    };
  }

  it("reprecifica TODAS as quantidades com preço e câmbio de uma única data", () => {
    const nav = buildNav(
      [
        q("xp", "itub4", 1000, "2026-07-31"),
        q("avenue", "googl", 20, "2026-07-28", "USD"),
      ],
      new Map([
        ["itub4", 34.5],
        ["googl", 178.5],
      ]),
      { USD: 5.42 },
      "2026-07-31",
    );

    expect(nav.isComplete).toBe(true);
    // Mesmo câmbio para tudo, mesmo que a quantidade venha de 28/07
    expect(nav.fxUsed.USD).toBe(5.42);
    expect(nav.totalBRL).toBeCloseTo(34_500 + 20 * 178.5 * 5.42, 2);
  });

  it("marca a quantidade que veio de data anterior", () => {
    const nav = buildNav(
      [q("avenue", "googl", 20, "2026-07-28")],
      new Map([["googl", 100]]),
      {},
      "2026-07-31",
    );

    expect(nav.lines[0]!.quantityIsCarriedForward).toBe(true);
    expect(nav.lines[0]!.quantityAsOf).toBe("2026-07-28");
    expect(nav.lines[0]!.price).toBe(100);
  });

  it("ativo sem preço na data BLOQUEIA o fechamento em vez de virar zero", () => {
    const nav = buildNav(
      [q("xp", "itub4", 1000, "2026-07-31"), q("xp", "misterioso", 10, "2026-07-31")],
      new Map([["itub4", 34.5]]),
      {},
      "2026-07-31",
    );

    expect(nav.isComplete).toBe(false);
    expect(nav.missingPrices).toHaveLength(1);
    expect(nav.missingPrices[0]!.ticker).toBe("MISTERIOSO");
    // O que tem preço continua somando — o gestor vê o quanto falta
    expect(nav.totalBRL).toBeCloseTo(34_500, 2);
  });

  it("reporta TODOS os preços faltantes de uma vez", () => {
    const nav = buildNav(
      [q("xp", "a", 1, "2026-07-31"), q("xp", "b", 1, "2026-07-31")],
      new Map(),
      {},
      "2026-07-31",
    );
    expect(nav.missingPrices).toHaveLength(2);
    expect(nav.isComplete).toBe(false);
  });

  it("NAV vazio não é considerado completo", () => {
    const nav = buildNav([], new Map(), {}, "2026-07-31");
    expect(nav.isComplete).toBe(false);
    expect(nav.totalBRL).toBe(0);
  });
});

describe("seleção de quantidades para o fechamento", () => {
  const positions = [
    { accountId: "xp", assetId: "a", referenceDate: "2026-06-30" },
    { accountId: "xp", assetId: "a", referenceDate: "2026-07-31" },
    { accountId: "xp", assetId: "a", referenceDate: "2026-08-31" },
    { accountId: "avenue", assetId: "b", referenceDate: "2026-07-28" },
  ];

  it("um fechamento de julho não usa quantidade de agosto", () => {
    const selecionadas = selectQuantitiesAsOf(positions, "2026-07-31");

    expect(selecionadas).toHaveLength(2);
    expect(selecionadas.map((x) => x.referenceDate).sort()).toEqual([
      "2026-07-28",
      "2026-07-31",
    ]);
  });

  it("usa a última posição de cada conta ATÉ a data de referência", () => {
    const selecionadas = selectQuantitiesAsOf(positions, "2026-07-15");
    // XP só tem 30/06 até essa data; Avenue ainda não tem nada
    expect(selecionadas).toHaveLength(1);
    expect(selecionadas[0]!.referenceDate).toBe("2026-06-30");
  });

  it("data anterior a tudo devolve vazio", () => {
    expect(selectQuantitiesAsOf(positions, "2026-01-01")).toEqual([]);
  });
});
