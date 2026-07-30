import { describe, expect, it } from "vitest";
import {
  computeDimensionalExposure,
  computeSingleDimension,
  unclassifiedShare,
  type AssetClassification,
  type OverrideMap,
} from "@/domain/exposure/compute";
import {
  deriveDimension,
  resolveDimension,
  type AssetTags,
  type RateIndex,
} from "@/domain/exposure/derive";
import {
  EXPOSURE_DIMENSIONS,
  type DimensionWeight,
  type ExposureDimension,
} from "@/domain/exposure/dimensions";
import {
  consolidatePositions,
  type PositionInput,
} from "@/domain/consolidation/consolidate";

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

/** GOOGL: o caso que define o modelo. */
const GOOGL = pos("googl", 100_000, {
  ticker: "GOOGL",
  assetName: "Alphabet Inc.",
  assetClass: "ACOES_ETF_EXTERIOR",
  country: "US",
  currency: "BRL", // já convertido, para o teste focar na classificação
  sector: "Tecnologia",
  riskBucket: "CORE",
});

function cls(
  assetType: string,
  indexador: RateIndex = "NONE",
  investmentStyle = "NAO_APLICAVEL",
): AssetClassification {
  return { assetType, indexador, investmentStyle };
}

const TIPOS = new Map([["googl", cls("ACAO")]]);

describe("dimensões são independentes — sem rateio entre elas", () => {
  it("R$ 100 mil em GOOGL contam INTEGRAIS em cada dimensão", () => {
    const exposures = consolidatePositions([GOOGL], {});
    const dims = computeDimensionalExposure(exposures, new Map(), TIPOS);

    // Sete dimensões, cada uma com R$ 100.000 — não R$ 100.000 divididos.
    expect(dims).toHaveLength(7);
    for (const dim of dims) {
      const soma = dim.buckets.reduce((acc, b) => acc + b.valueBRL, 0);
      expect(soma).toBeCloseTo(100_000, 2);
    }
  });

  it("Equity EUA e Tecnologia valem R$ 100 mil CADA, não R$ 50 mil", () => {
    const exposures = consolidatePositions([GOOGL], {});
    const dims = computeDimensionalExposure(exposures, new Map(), TIPOS);

    const macro = dims.find((d) => d.dimension === "MACRO")!;
    const setor = dims.find((d) => d.dimension === "SETOR_TEMA")!;

    const equityUS = macro.buckets.find((b) => b.tag === "EQUITY_US")!;
    const tech = setor.buckets.find((b) => b.tag === "TECNOLOGIA_AI")!;

    expect(equityUS.valueBRL).toBeCloseTo(100_000, 2);
    expect(tech.valueBRL).toBeCloseTo(100_000, 2);
    // O erro do modelo anterior seria 50.000 em cada
    expect(equityUS.valueBRL).not.toBeCloseTo(50_000, 2);
    expect(tech.valueBRL).not.toBeCloseTo(50_000, 2);
  });

  it("dentro de cada dimensão os percentuais somam 100%", () => {
    const exposures = consolidatePositions(
      [
        pos("a", 400_000, { sector: "Tecnologia" }),
        pos("b", 300_000, { assetClass: "FII_IMOBILIARIO", riskBucket: "CORE" }),
        pos("c", 200_000, {
          country: "US",
          assetClass: "ACOES_ETF_EXTERIOR",
          riskBucket: "GROWTH",
        }),
        pos("d", 100_000, { assetClass: "RF_BRASIL", riskBucket: "DEFENSIVE" }),
      ],
      {},
    );

    const dims = computeDimensionalExposure(
      exposures,
      new Map(),
      new Map([
        ["a", cls("ACAO")],
        ["b", cls("FII")],
        ["c", cls("ACAO")],
        ["d", cls("CDB")],
      ]),
    );

    for (const dim of dims) {
      const soma = dim.buckets.reduce((acc, b) => acc + b.percentage, 0);
      expect(soma).toBeCloseTo(100, 2);
    }
  });

  it("todas as dimensões usam a mesma base patrimonial", () => {
    const exposures = consolidatePositions(
      [pos("a", 600_000), pos("b", 400_000, { assetClass: "RF_BRASIL" })],
      {},
    );
    const dims = computeDimensionalExposure(exposures, new Map(), new Map());

    for (const dim of dims) {
      expect(dim.totalBRL).toBeCloseTo(1_000_000, 2);
    }
  });
});

describe("pesos somam 1 dentro de cada dimensão", () => {
  const casos = [
    { assetType: "TESOURO_DIRETO", name: "Tesouro IPCA+ 2035" },
    { assetType: "TESOURO_DIRETO", name: "Tesouro Selic 2029" },
    { assetType: "CDB", name: "CDB" },
    { assetType: "DEBENTURE", name: "Debênture Incentivada" },
    { assetType: "CRI", name: "CRI" },
    { assetType: "CRA", name: "CRA" },
    { assetType: "ACAO", name: "Ação" },
    { assetType: "ETF", name: "ETF" },
    { assetType: "FII", name: "FII" },
    { assetType: "REIT", name: "REIT" },
    { assetType: "BOND", name: "Bond" },
    { assetType: "FUNDO", name: "Fundo" },
    { assetType: "CAIXA", name: "Caixa" },
  ];

  it.each(casos)("$assetType em todas as dimensões", ({ assetType, name }) => {
    const asset: AssetTags = {
      assetType,
      assetClass: "RF_BRASIL",
      country: "BR",
      currency: "BRL",
      sector: null,
      riskBucket: "CORE",
      investmentStyle: "NAO_APLICAVEL",
      indexador: "NONE",
      name,
    };
    for (const dimension of EXPOSURE_DIMENSIONS) {
      const weights = deriveDimension(asset, dimension);
      const soma = weights.reduce((acc, item) => acc + item.weight, 0);
      expect(soma).toBeCloseTo(1, 5);
    }
  });
});

describe("divisão dentro de uma dimensão só quando é economicamente real", () => {
  it("debênture IPCA+ divide entre crédito e inflação em MACRO", () => {
    const macro = deriveDimension(
      {
        assetType: "DEBENTURE",
        assetClass: "RF_BRASIL",
        country: "BR",
        currency: "BRL",
        sector: "Energia",
        riskBucket: "DEFENSIVE",
        investmentStyle: "NAO_APLICAVEL",
        indexador: "IPCA",
        name: "Debênture Engie IPCA+",
      },
      "MACRO",
    );

    expect(macro.map((m) => m.tag).sort()).toEqual(["CREDITO_BR", "INFLACAO_BR"]);
    expect(macro.reduce((a, m) => a + m.weight, 0)).toBeCloseTo(1, 5);
  });

  it("mas a mesma debênture é 100% Energia em SETOR_TEMA", () => {
    const setor = deriveDimension(
      {
        assetType: "DEBENTURE",
        assetClass: "RF_BRASIL",
        country: "BR",
        currency: "BRL",
        sector: "Energia",
        riskBucket: "DEFENSIVE",
        investmentStyle: "NAO_APLICAVEL",
        indexador: "IPCA",
        name: "Debênture Engie IPCA+",
      },
      "SETOR_TEMA",
    );

    expect(setor).toEqual([{ tag: "ENERGIA", weight: 1 }]);
  });

  it("ação de commodity divide em MACRO mas é integral em GEOGRAFIA", () => {
    const asset = {
      assetType: "ACAO",
      assetClass: "ACOES_BRASIL" as const,
      country: "BR",
      currency: "BRL" as const,
      sector: "Energia",
      riskBucket: "CORE" as const,
      investmentStyle: "NAO_APLICAVEL",
      indexador: "NONE" as const,
      name: "Petrobras",
    };

    expect(deriveDimension(asset, "MACRO")).toHaveLength(2);
    expect(deriveDimension(asset, "GEOGRAFIA")).toEqual([
      { tag: "BRASIL", weight: 1 },
    ]);
  });
});

describe("equity emergentes deixou de cair em residual", () => {
  it("ETF de emergentes tem fator macro próprio", () => {
    const macro = deriveDimension(
      {
        assetType: "ETF",
        assetClass: "ACOES_ETF_EXTERIOR",
        country: "CN",
        currency: "USD",
        sector: null,
        riskBucket: "SATELLITE",
        investmentStyle: "INDICE",
        indexador: "NONE",
        name: "Vanguard Emerging Markets",
      },
      "MACRO",
    );

    expect(macro).toEqual([{ tag: "EQUITY_EMERGENTES", weight: 1 }]);
  });

  it("e aparece em GEOGRAFIA como China", () => {
    const geo = deriveDimension(
      {
        assetType: "ETF",
        assetClass: "ACOES_ETF_EXTERIOR",
        country: "CN",
        currency: "USD",
        sector: null,
        riskBucket: "SATELLITE",
        investmentStyle: "INDICE",
        indexador: "NONE",
        name: "Vanguard Emerging Markets",
      },
      "GEOGRAFIA",
    );
    expect(geo).toEqual([{ tag: "CHINA", weight: 1 }]);
  });
});

describe("sobreposição manual é por dimensão", () => {
  it("substitui apenas a dimensão sobreposta", () => {
    const overrides: OverrideMap = new Map([
      [
        "googl",
        new Map<ExposureDimension, DimensionWeight[]>([
          ["MACRO", [{ tag: "EQUITY_EMERGENTES", weight: 1 }]],
        ]),
      ],
    ]);

    const exposures = consolidatePositions([GOOGL], {});
    const dims = computeDimensionalExposure(exposures, overrides, TIPOS);

    const macro = dims.find((d) => d.dimension === "MACRO")!;
    const setor = dims.find((d) => d.dimension === "SETOR_TEMA")!;

    // MACRO foi sobreposto…
    expect(macro.buckets[0]!.tag).toBe("EQUITY_EMERGENTES");
    // …mas SETOR_TEMA continua derivado automaticamente
    expect(setor.buckets[0]!.tag).toBe("TECNOLOGIA_AI");
  });

  it("renormaliza sobreposição que não soma 1", () => {
    const resolved = resolveDimension(
      {
        assetType: "FUNDO",
        assetClass: "MULTIMERCADO_ALTERNATIVO",
        country: "BR",
        currency: "BRL",
        sector: null,
        riskBucket: "SATELLITE",
        investmentStyle: "NAO_APLICAVEL",
        indexador: "NONE",
        name: "Fundo",
      },
      "MACRO",
      [
        { tag: "EQUITY_BR", weight: 3 },
        { tag: "JUROS_BR", weight: 1 },
      ],
    );

    expect(resolved.reduce((a, r) => a + r.weight, 0)).toBeCloseTo(1, 5);
    expect(resolved[0]!.weight).toBeCloseTo(0.75, 5);
  });
});

describe("consolidação antes de classificar", () => {
  it("soma o mesmo ativo entre corretoras antes de dimensionar", () => {
    const exposures = consolidatePositions(
      [
        { ...GOOGL, brokerId: "avenue", currentPrice: 60_000, averageCost: 60_000 },
        {
          ...GOOGL,
          accountId: "acc2",
          brokerId: "ibkr",
          currentPrice: 40_000,
          averageCost: 40_000,
        },
      ],
      {},
    );

    const dims = computeDimensionalExposure(exposures, new Map(), TIPOS);
    const setor = dims.find((d) => d.dimension === "SETOR_TEMA")!;
    const tech = setor.buckets.find((b) => b.tag === "TECNOLOGIA_AI")!;

    expect(tech.valueBRL).toBeCloseTo(100_000, 2);
    expect(tech.assetCount).toBe(1);
  });
});

describe("qualidade da classificação", () => {
  it("mede o percentual não classificado de uma dimensão", () => {
    const exposures = consolidatePositions(
      [
        pos("cdb", 300_000, { assetClass: "RF_BRASIL", riskBucket: "DEFENSIVE" }),
        pos("acao", 700_000, { sector: "Financeiro" }),
      ],
      {},
    );

    const setor = computeSingleDimension(
      "SETOR_TEMA",
      exposures,
      new Map(),
      new Map([
        ["cdb", cls("CDB")],
        ["acao", cls("ACAO")],
      ]),
      1_000_000,
    );

    // CDB não tem setor aplicável
    expect(unclassifiedShare(setor)).toBeCloseTo(30, 2);
  });

  it("carteira vazia não produz dimensões", () => {
    expect(computeDimensionalExposure([], new Map(), new Map())).toEqual([]);
  });
});

describe("inflação vem do INDEXADOR, não do regime tributário", () => {
  function rf(assetType: string, indexador: RateIndex, name: string): AssetTags {
    return {
      assetType,
      assetClass: "RF_BRASIL",
      country: "BR",
      currency: "BRL",
      sector: null,
      riskBucket: "DEFENSIVE",
      investmentStyle: "RENDA",
      indexador,
      name,
    };
  }

  it("debênture INCENTIVADA em CDI NÃO carrega inflação", () => {
    // "Incentivada" é isenção de IR (Lei 12.431), não indexação.
    const macro = deriveDimension(
      rf("DEBENTURE", "CDI", "Debênture Incentivada Engie"),
      "MACRO",
    );
    expect(macro.map((m) => m.tag)).not.toContain("INFLACAO_BR");
    expect(macro.map((m) => m.tag).sort()).toEqual(["CREDITO_BR", "JUROS_BR"]);
  });

  it("debênture COMUM em IPCA carrega inflação", () => {
    const macro = deriveDimension(
      rf("DEBENTURE", "IPCA", "Debênture Simples"),
      "MACRO",
    );
    expect(macro.map((m) => m.tag)).toContain("INFLACAO_BR");
  });

  it("o nome do papel não influencia mais o resultado", () => {
    const comNomeIncentivada = deriveDimension(
      rf("DEBENTURE", "CDI", "Debênture Incentivada IPCA Inflação"),
      "MACRO",
    );
    const comNomeNeutro = deriveDimension(
      rf("DEBENTURE", "CDI", "XYZ"),
      "MACRO",
    );
    expect(comNomeIncentivada).toEqual(comNomeNeutro);
  });

  it("IGPM também conta como inflação", () => {
    expect(
      deriveDimension(rf("CRI", "IGPM", "CRI"), "MACRO").map((m) => m.tag),
    ).toContain("INFLACAO_BR");
  });

  it("Tesouro Selic e prefixado não carregam inflação", () => {
    for (const idx of ["SELIC", "PREFIXADO", "CDI"] as RateIndex[]) {
      const macro = deriveDimension(
        rf("TESOURO_DIRETO", idx, "Tesouro"),
        "MACRO",
      );
      expect(macro.map((m) => m.tag)).not.toContain("INFLACAO_BR");
    }
  });

  it("Tesouro IPCA+ carrega inflação e juros real", () => {
    const macro = deriveDimension(
      rf("TESOURO_DIRETO", "IPCA", "Tesouro IPCA+ 2035"),
      "MACRO",
    );
    expect(macro.map((m) => m.tag).sort()).toEqual(["INFLACAO_BR", "JUROS_BR"]);
  });

  it("CRI e CRA sem indexação inflacionária trocam inflação por juros", () => {
    const cri = deriveDimension(rf("CRI", "CDI", "CRI"), "MACRO");
    expect(cri.map((m) => m.tag)).toContain("JUROS_BR");
    expect(cri.map((m) => m.tag)).not.toContain("INFLACAO_BR");
  });
});

describe("estilo de investimento é separado de risk bucket", () => {
  function asset(
    riskBucket: AssetTags["riskBucket"],
    investmentStyle: string,
    assetType = "ACAO",
  ): AssetTags {
    return {
      assetType,
      assetClass: "ACOES_BRASIL",
      country: "BR",
      currency: "BRL",
      sector: null,
      riskBucket,
      investmentStyle,
      indexador: "NONE",
      name: "Ativo",
    };
  }

  it("são dimensões distintas com respostas distintas", () => {
    const a = asset("CORE", "GROWTH");
    expect(deriveDimension(a, "RISK_BUCKET")).toEqual([{ tag: "CORE", weight: 1 }]);
    expect(deriveDimension(a, "ESTILO")).toEqual([{ tag: "GROWTH", weight: 1 }]);
  });

  it("GROWTH em risk bucket não implica GROWTH em estilo", () => {
    const a = asset("GROWTH", "VALUE");
    expect(deriveDimension(a, "RISK_BUCKET")[0]!.tag).toBe("GROWTH");
    expect(deriveDimension(a, "ESTILO")[0]!.tag).toBe("VALUE");
  });

  it("um ETF pode ser INDICE em estilo e CORE em risk bucket", () => {
    const a = asset("CORE", "NAO_APLICAVEL", "ETF");
    expect(deriveDimension(a, "ESTILO")).toEqual([{ tag: "INDICE", weight: 1 }]);
    expect(deriveDimension(a, "RISK_BUCKET")).toEqual([{ tag: "CORE", weight: 1 }]);
  });

  it("sem estilo declarado, infere pelo instrumento e nunca pelo bucket", () => {
    expect(deriveDimension(asset("ASYMMETRIC", "", "FII"), "ESTILO")).toEqual([
      { tag: "DIVIDENDOS", weight: 1 },
    ]);
    expect(deriveDimension(asset("GROWTH", "", "CDB"), "ESTILO")).toEqual([
      { tag: "RENDA", weight: 1 },
    ]);
  });
});
