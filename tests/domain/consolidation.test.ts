import { describe, expect, it } from "vitest";
import {
  assetWeights,
  consolidatePositions,
  groupExposureBy,
  totalFinancialValueBRL,
  type PositionInput,
} from "@/domain/consolidation/consolidate";
import { MissingFxRateError } from "@/domain/money/convert";

/**
 * O PRINCÍPIO FUNDAMENTAL SOB TESTE
 * ==================================
 * Uma mesma empresa pode existir em duas ou mais corretoras. O sistema separa
 * CUSTÓDIA de EXPOSIÇÃO ECONÔMICA — e é a exposição que vale para risco e peso.
 */

const FX = { USD: 5.42 } as const;

function position(overrides: Partial<PositionInput> = {}): PositionInput {
  return {
    accountId: "acc-1",
    accountName: "Avenue - Conta USD",
    brokerId: "broker-avenue",
    brokerName: "Avenue",
    assetId: "asset-googl",
    ticker: "GOOGL",
    assetName: "Alphabet Inc. Class A",
    assetClass: "ACOES_ETF_EXTERIOR",
    riskBucket: "CORE",
    currency: "USD",
    country: "US",
    sector: "Tecnologia",
    quantity: 10,
    averageCost: 140,
    currentPrice: 180,
    ...overrides,
  };
}

describe("consolidação do mesmo ativo entre corretoras", () => {
  it("soma GOOGL da Avenue e da Interactive Brokers numa única exposição", () => {
    const positions = [
      position({ quantity: 20, averageCost: 141.8 }),
      position({
        accountId: "acc-2",
        accountName: "IBKR - Conta USD",
        brokerId: "broker-ibkr",
        brokerName: "Interactive Brokers",
        quantity: 30,
        averageCost: 152.4,
      }),
    ];

    const [exposure] = consolidatePositions(positions, FX);

    expect(exposure).toBeDefined();
    // Uma exposição, não duas
    expect(consolidatePositions(positions, FX)).toHaveLength(1);
    expect(exposure!.ticker).toBe("GOOGL");
    expect(exposure!.quantity).toBe(50);
    // 50 × US$ 180 × 5,42
    expect(exposure!.valueBRL).toBeCloseTo(48_780, 2);
    expect(exposure!.custodyCount).toBe(2);
    expect(exposure!.custodies).toHaveLength(2);
  });

  it("preserva a quebra por corretora dentro da exposição consolidada", () => {
    const positions = [
      position({ quantity: 20 }),
      position({
        accountId: "acc-2",
        brokerId: "broker-ibkr",
        brokerName: "Interactive Brokers",
        quantity: 30,
      }),
    ];

    const [exposure] = consolidatePositions(positions, FX);
    const custodies = exposure!.custodies;

    const avenue = custodies.find((c) => c.brokerName === "Avenue");
    const ibkr = custodies.find((c) => c.brokerName === "Interactive Brokers");

    expect(avenue!.quantity).toBe(20);
    expect(ibkr!.quantity).toBe(30);
    expect(avenue!.shareOfAsset).toBeCloseTo(40, 4);
    expect(ibkr!.shareOfAsset).toBeCloseTo(60, 4);
    // As partes somam o todo
    expect(avenue!.valueBRL + ibkr!.valueBRL).toBeCloseTo(exposure!.valueBRL, 2);
  });

  it("pondera o custo médio pela quantidade, não pela média aritmética", () => {
    const positions = [
      position({ quantity: 10, averageCost: 100 }),
      position({
        accountId: "acc-2",
        brokerId: "broker-ibkr",
        quantity: 90,
        averageCost: 200,
      }),
    ];

    const [exposure] = consolidatePositions(positions, FX);

    // Ponderado: (10×100 + 90×200)/100 = 190. A média aritmética seria 150.
    expect(exposure!.averageCost).toBeCloseTo(190, 4);
    expect(exposure!.averageCost).not.toBeCloseTo(150, 4);
  });

  it("trata custo desconhecido como null, jamais como zero", () => {
    const positions = [
      position({ quantity: 10, averageCost: 100 }),
      position({ accountId: "acc-2", quantity: 10, averageCost: null }),
    ];

    const [exposure] = consolidatePositions(positions, FX);

    expect(exposure!.averageCost).toBeNull();
    expect(exposure!.costBRL).toBeNull();
    expect(exposure!.unrealizedResultBRL).toBeNull();
    expect(exposure!.unrealizedResultPercent).toBeNull();
  });

  it("não mistura ativos diferentes", () => {
    const exposures = consolidatePositions(
      [
        position(),
        position({ assetId: "asset-msft", ticker: "MSFT", quantity: 5 }),
      ],
      FX,
    );

    expect(exposures).toHaveLength(2);
    expect(exposures.map((e) => e.ticker).sort()).toEqual(["GOOGL", "MSFT"]);
  });

  it("calcula resultado não realizado em BRL e em %", () => {
    const [exposure] = consolidatePositions(
      [position({ quantity: 10, averageCost: 100, currentPrice: 150 })],
      FX,
    );

    // custo 10×100×5,42 = 5.420 ; valor 10×150×5,42 = 8.130
    expect(exposure!.costBRL).toBeCloseTo(5_420, 2);
    expect(exposure!.valueBRL).toBeCloseTo(8_130, 2);
    expect(exposure!.unrealizedResultBRL).toBeCloseTo(2_710, 2);
    expect(exposure!.unrealizedResultPercent).toBeCloseTo(50, 4);
  });
});

describe("conversão cambial", () => {
  it("exige taxa registrada e nunca assume 1 para moeda estrangeira", () => {
    expect(() => consolidatePositions([position()], {})).toThrow(
      MissingFxRateError,
    );
  });

  it("usa taxa 1 para BRL sem precisar de registro", () => {
    const [exposure] = consolidatePositions(
      [position({ currency: "BRL", quantity: 100, currentPrice: 10 })],
      {},
    );
    expect(exposure!.valueBRL).toBeCloseTo(1_000, 2);
  });
});

describe("pesos e agrupamentos", () => {
  const carteira = [
    position({ assetId: "a1", ticker: "A", currency: "BRL", quantity: 1, currentPrice: 600, country: "BR", sector: "Financeiro" }),
    position({ assetId: "a2", ticker: "B", currency: "BRL", quantity: 1, currentPrice: 300, country: "BR", sector: "Tecnologia" }),
    position({ assetId: "a3", ticker: "C", currency: "BRL", quantity: 1, currentPrice: 100, country: "US", sector: "Tecnologia" }),
  ];

  it("calcula o peso de cada ativo na carteira global", () => {
    const weights = assetWeights(consolidatePositions(carteira, FX));

    expect(weights.get("a1")).toBeCloseTo(60, 4);
    expect(weights.get("a2")).toBeCloseTo(30, 4);
    expect(weights.get("a3")).toBeCloseTo(10, 4);
  });

  it("os pesos somam 100%", () => {
    const weights = [...assetWeights(consolidatePositions(carteira, FX)).values()];
    const soma = weights.reduce((acc, w) => acc + w, 0);
    expect(soma).toBeCloseTo(100, 4);
  });

  it("agrupa por qualquer dimensão", () => {
    const exposures = consolidatePositions(carteira, FX);

    const porPais = groupExposureBy(exposures, (e) => e.country);
    expect(porPais.find((g) => g.key === "BR")!.weight).toBeCloseTo(90, 4);
    expect(porPais.find((g) => g.key === "US")!.weight).toBeCloseTo(10, 4);

    const porSetor = groupExposureBy(exposures, (e) => e.sector ?? "Outros");
    expect(porSetor.find((g) => g.key === "Tecnologia")!.weight).toBeCloseTo(40, 4);
  });

  it("não divide por zero em carteira vazia", () => {
    expect(totalFinancialValueBRL([])).toBe(0);
    expect(assetWeights([]).size).toBe(0);
    expect(groupExposureBy([], (e) => e.country)).toEqual([]);
  });
});
