import { describe, expect, it } from "vitest";
import {
  deriveFactorWeights,
  resolveFactorWeights,
  type FactorDerivationInput,
} from "@/domain/factors/derive";
import {
  computeFactorExposure,
  unclassifiedShare,
} from "@/domain/factors/exposure";
import {
  consolidatePositions,
  type PositionInput,
} from "@/domain/consolidation/consolidate";
import type { RiskFactor } from "@/domain/factors/types";

function asset(
  overrides: Partial<FactorDerivationInput> = {},
): FactorDerivationInput {
  return {
    assetType: "ACAO",
    assetClass: "ACOES_BRASIL",
    country: "BR",
    currency: "BRL",
    sector: null,
    riskBucket: "CORE",
    name: "Ativo",
    ...overrides,
  };
}

function sumWeights(weights: readonly { weight: number }[]): number {
  return weights.reduce((acc, item) => acc + item.weight, 0);
}

describe("derivação automática de fatores", () => {
  it("os pesos de um ativo sempre somam 1", () => {
    const casos: FactorDerivationInput[] = [
      asset({ assetType: "TESOURO_DIRETO", name: "Tesouro IPCA+ 2035" }),
      asset({ assetType: "TESOURO_DIRETO", name: "Tesouro Selic 2029" }),
      asset({ assetType: "CDB" }),
      asset({ assetType: "DEBENTURE", name: "Debênture Incentivada Engie", sector: "Energia" }),
      asset({ assetType: "CRI" }),
      asset({ assetType: "CRA" }),
      asset({ assetType: "ACAO", sector: "Tecnologia" }),
      asset({ assetType: "ETF", country: "US", assetClass: "ACOES_ETF_EXTERIOR" }),
      asset({ assetType: "FII" }),
      asset({ assetType: "REIT", country: "US" }),
      asset({ assetType: "BOND", country: "US" }),
      asset({ assetType: "FUNDO" }),
    ];

    for (const caso of casos) {
      const weights = deriveFactorWeights(caso);
      expect(sumWeights(weights)).toBeCloseTo(1, 5);
    }
  });

  it("separa Tesouro IPCA+ de Tesouro Selic", () => {
    const ipca = deriveFactorWeights(
      asset({ assetType: "TESOURO_DIRETO", name: "Tesouro IPCA+ 2035" }),
    );
    const selic = deriveFactorWeights(
      asset({ assetType: "TESOURO_DIRETO", name: "Tesouro Selic 2029" }),
    );

    expect(ipca.map((f) => f.factor)).toContain("INFLACAO_BR");
    expect(selic.map((f) => f.factor)).toEqual(["JUROS_BR"]);
  });

  it("CRI carrega crédito E imobiliário, mesmo estando em RF Brasil", () => {
    const factors = deriveFactorWeights(
      asset({ assetType: "CRI", assetClass: "RF_BRASIL" }),
    ).map((f) => f.factor);

    expect(factors).toContain("CREDITO_BR");
    expect(factors).toContain("IMOBILIARIO");
  });

  it("CRA carrega commodities", () => {
    const factors = deriveFactorWeights(
      asset({ assetType: "CRA", assetClass: "RF_BRASIL" }),
    ).map((f) => f.factor);
    expect(factors).toContain("COMMODITIES");
  });

  it("ação de tecnologia divide entre equity do país e TECH_AI", () => {
    const brasil = deriveFactorWeights(asset({ sector: "Tecnologia" }));
    const eua = deriveFactorWeights(
      asset({ country: "US", sector: "Tecnologia", assetClass: "ACOES_ETF_EXTERIOR" }),
    );

    expect(brasil.map((f) => f.factor).sort()).toEqual(["EQUITY_BR", "TECH_AI"]);
    expect(eua.map((f) => f.factor).sort()).toEqual(["EQUITY_US", "TECH_AI"]);
  });

  it("ação de energia ou mineração carrega commodities", () => {
    const petro = deriveFactorWeights(asset({ sector: "Energia" }));
    const vale = deriveFactorWeights(asset({ sector: "Materiais" }));

    expect(petro.map((f) => f.factor)).toContain("COMMODITIES");
    expect(vale.map((f) => f.factor)).toContain("COMMODITIES");
  });

  it("ETF de renda fixa internacional é duration USD, não equity", () => {
    const factors = deriveFactorWeights(
      asset({ assetType: "ETF", assetClass: "RF_CAIXA_EXTERIOR", country: "US" }),
    );
    expect(factors).toEqual([{ factor: "DURATION_USD", weight: 1 }]);
  });

  it("FII é integralmente imobiliário", () => {
    expect(
      deriveFactorWeights(asset({ assetType: "FII", assetClass: "FII_IMOBILIARIO" })),
    ).toEqual([{ factor: "IMOBILIARIO", weight: 1 }]);
  });

  it("caixa não carrega fator algum", () => {
    expect(deriveFactorWeights(asset({ assetType: "CAIXA" }))).toEqual([]);
  });

  it("equity fora de BR/US cai em OUTROS, de forma visível", () => {
    const factors = deriveFactorWeights(
      asset({ assetType: "ETF", country: "CN", assetClass: "ACOES_ETF_EXTERIOR" }),
    );
    expect(factors).toEqual([{ factor: "OUTROS", weight: 1 }]);
  });
});

describe("sobreposição manual", () => {
  it("prevalece sobre a derivação automática", () => {
    const overrides = [
      { factor: "TECH_AI" as RiskFactor, weight: 0.8 },
      { factor: "EQUITY_US" as RiskFactor, weight: 0.2 },
    ];

    const resolved = resolveFactorWeights(asset({ sector: "Tecnologia" }), overrides);
    expect(resolved.map((f) => f.factor)).toEqual(["TECH_AI", "EQUITY_US"]);
  });

  it("renormaliza sobreposição que não soma 1", () => {
    const resolved = resolveFactorWeights(asset(), [
      { factor: "EQUITY_BR", weight: 2 },
      { factor: "COMMODITIES", weight: 2 },
    ]);
    expect(sumWeights(resolved)).toBeCloseTo(1, 5);
    expect(resolved[0]!.weight).toBeCloseTo(0.5, 5);
  });

  it("lista vazia volta para a derivação automática", () => {
    const resolved = resolveFactorWeights(asset({ assetType: "FII" }), []);
    expect(resolved).toEqual([{ factor: "IMOBILIARIO", weight: 1 }]);
  });
});

describe("exposição fatorial da carteira", () => {
  function pos(
    id: string,
    valor: number,
    overrides: Partial<PositionInput> = {},
  ): PositionInput {
    return {
      accountId: "acc",
      accountName: "Conta",
      brokerId: "broker",
      brokerName: "Corretora",
      assetId: id,
      ticker: id.toUpperCase(),
      assetName: id,
      assetClass: "ACOES_BRASIL",
      riskBucket: "CORE",
      currency: "BRL",
      country: "BR",
      sector: null,
      quantity: 1,
      averageCost: valor,
      currentPrice: valor,
      ...overrides,
    };
  }

  it("rateia o valor do ativo entre seus fatores", () => {
    const exposures = consolidatePositions(
      [pos("tec", 100_000, { sector: "Tecnologia" })],
      {},
    );
    const factors = computeFactorExposure(
      exposures,
      new Map(),
      new Map([["tec", "ACAO"]]),
    );

    const equity = factors.find((f) => f.factor === "EQUITY_BR");
    const tech = factors.find((f) => f.factor === "TECH_AI");

    expect(equity!.valueBRL).toBeCloseTo(50_000, 2);
    expect(tech!.valueBRL).toBeCloseTo(50_000, 2);
    expect(equity!.percentage).toBeCloseTo(50, 2);
  });

  it("os percentuais somam 100% do capital exposto", () => {
    const exposures = consolidatePositions(
      [
        pos("a", 500_000, { sector: "Tecnologia" }),
        pos("b", 300_000, { assetClass: "FII_IMOBILIARIO" }),
        pos("c", 200_000, { sector: "Energia" }),
      ],
      {},
    );

    const factors = computeFactorExposure(
      exposures,
      new Map(),
      new Map([
        ["a", "ACAO"],
        ["b", "FII"],
        ["c", "ACAO"],
      ]),
    );

    const soma = factors.reduce((acc, f) => acc + f.percentage, 0);
    expect(soma).toBeCloseTo(100, 2);
  });

  it("consolida o mesmo fator vindo de classes diferentes", () => {
    // Um CRI (RF Brasil) e um FII (Imobiliário) carregam o MESMO fator
    // imobiliário. É essa concentração que a visão por classe esconde.
    const exposures = consolidatePositions(
      [
        pos("cri", 100_000, { assetClass: "RF_BRASIL" }),
        pos("fii", 100_000, { assetClass: "FII_IMOBILIARIO" }),
      ],
      {},
    );

    const factors = computeFactorExposure(
      exposures,
      new Map(),
      new Map([
        ["cri", "CRI"],
        ["fii", "FII"],
      ]),
    );

    const imob = factors.find((f) => f.factor === "IMOBILIARIO");
    // FII inteiro (100k) + 35% do CRI (35k) = 135k
    expect(imob!.valueBRL).toBeCloseTo(135_000, 2);
    expect(imob!.assetCount).toBe(2);
  });

  it("soma a exposição do mesmo ativo entre corretoras antes de fatorar", () => {
    const exposures = consolidatePositions(
      [
        pos("googl", 50_000, {
          sector: "Tecnologia",
          country: "US",
          assetClass: "ACOES_ETF_EXTERIOR",
          brokerId: "avenue",
        }),
        pos("googl", 50_000, {
          sector: "Tecnologia",
          country: "US",
          assetClass: "ACOES_ETF_EXTERIOR",
          accountId: "acc2",
          brokerId: "ibkr",
        }),
      ],
      {},
    );

    const factors = computeFactorExposure(
      exposures,
      new Map(),
      new Map([["googl", "ACAO"]]),
    );

    // 100k consolidados, 50% em TECH_AI
    expect(factors.find((f) => f.factor === "TECH_AI")!.valueBRL).toBeCloseTo(
      50_000,
      2,
    );
  });

  it("caixa fica fora da base de fatores", () => {
    const exposures = consolidatePositions(
      [
        pos("acoes", 100_000),
        pos("caixa", 100_000, { assetClass: "CAIXA_BR", riskBucket: "CASH" }),
      ],
      {},
    );

    const factors = computeFactorExposure(
      exposures,
      new Map(),
      new Map([
        ["acoes", "ACAO"],
        ["caixa", "CAIXA"],
      ]),
    );

    // 200k de patrimônio, mas só 100k expostos a fator
    expect(factors.find((f) => f.factor === "EQUITY_BR")!.percentage).toBeCloseTo(
      100,
      2,
    );
  });

  it("carteira vazia não produz fatores", () => {
    expect(computeFactorExposure([], new Map(), new Map())).toEqual([]);
  });

  it("informa quanto ficou sem classificação", () => {
    const exposures = consolidatePositions(
      [
        pos("emergentes", 300_000, {
          assetClass: "ACOES_ETF_EXTERIOR",
          country: "CN",
        }),
        pos("acoes", 700_000),
      ],
      {},
    );

    const factors = computeFactorExposure(
      exposures,
      new Map(),
      new Map([
        ["emergentes", "ETF"],
        ["acoes", "ACAO"],
      ]),
    );

    expect(unclassifiedShare(factors)).toBeCloseTo(30, 2);
  });
});
