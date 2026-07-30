import { describe, expect, it } from "vitest";
import {
  computeDimensionalExposure,
  type AssetClassification,
} from "@/domain/exposure/compute";
import {
  deriveDimension,
  resolveDimension,
  type AssetTags,
  type RateIndex,
} from "@/domain/exposure/derive";
import {
  DIMENSION_KIND,
  EXPOSURE_DIMENSIONS,
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

describe("dimensões de PARTIÇÃO somam o patrimônio inteiro", () => {
  it("R$ 100 mil em GOOGL contam integrais em cada partição", () => {
    const exposures = consolidatePositions([GOOGL], {});
    const dims = computeDimensionalExposure(exposures, new Map(), TIPOS);

    expect(dims).toHaveLength(9);
    for (const dim of dims.filter((d) => d.kind === "PARTICAO")) {
      const soma = dim.buckets.reduce((acc, b) => acc + b.valueBRL, 0);
      expect(soma).toBeCloseTo(100_000, 2);
      expect(dim.percentageSum).toBeCloseTo(100, 2);
    }
  });

  it("Equity EUA e Tecnologia valem R$ 100 mil CADA, não R$ 50 mil", () => {
    const exposures = consolidatePositions([GOOGL], {});
    const dims = computeDimensionalExposure(exposures, new Map(), TIPOS);

    const equityUS = dims.find((d) => d.dimension === "MACRO")!
      .buckets.find((b) => b.tag === "EQUITY_US")!;
    const tech = dims.find((d) => d.dimension === "TEMA")!
      .buckets.find((b) => b.tag === "TECNOLOGIA_AI")!;

    expect(equityUS.valueBRL).toBeCloseTo(100_000, 2);
    expect(tech.valueBRL).toBeCloseTo(100_000, 2);
    expect(equityUS.valueBRL).not.toBeCloseTo(50_000, 2);
  });

  it("todas as dimensões usam a mesma base patrimonial", () => {
    const exposures = consolidatePositions(
      [pos("a", 600_000), pos("b", 400_000, { assetClass: "RF_BRASIL" })],
      {},
    );
    const dims = computeDimensionalExposure(exposures, new Map(), new Map());
    for (const dim of dims) expect(dim.totalBRL).toBeCloseTo(1_000_000, 2);
  });
});

describe("FATORES MACRO são SOBREPOSTOS — nunca rateados", () => {
  function rf(assetType: string, indexador: RateIndex, name = "Papel"): AssetTags {
    return {
      assetType,
      assetClass: "RF_BRASIL",
      country: "BR",
      currency: "BRL",
      rawSector: null,
      riskBucket: "DEFENSIVE",
      investmentStyle: "RENDA",
      indexador,
      name,
    };
  }

  it("Tesouro IPCA+ carrega inflação, juro real E duration, cada um por INTEIRO", () => {
    const macro = deriveDimension(rf("TESOURO_DIRETO", "IPCA", "Tesouro IPCA+ 2035"), "MACRO");
    const tags = macro.map((m) => m.tag).sort();

    expect(tags).toEqual(["DURATION_BR", "INFLACAO_IPCA", "JUROS_REAL_BR"]);
    // Cada fator recebe o papel inteiro — nada de 70/30
    for (const m of macro) expect(m.weight).toBe(1);
  });

  it("R$ 100 mil em Tesouro IPCA+ dão R$ 100 mil em CADA fator", () => {
    const exposures = consolidatePositions(
      [pos("ntnb", 100_000, { assetClass: "RF_BRASIL", riskBucket: "DEFENSIVE" })],
      {},
    );
    const dims = computeDimensionalExposure(
      exposures,
      new Map(),
      new Map([["ntnb", cls("TESOURO_DIRETO", "IPCA")]]),
    );
    const macro = dims.find((d) => d.dimension === "MACRO")!;

    expect(macro.kind).toBe("SOBREPOSICAO");
    for (const tag of ["INFLACAO_IPCA", "JUROS_REAL_BR", "DURATION_BR"]) {
      expect(macro.buckets.find((b) => b.tag === tag)!.valueBRL).toBeCloseTo(100_000, 2);
      expect(macro.buckets.find((b) => b.tag === tag)!.percentage).toBeCloseTo(100, 2);
    }
    // A soma ULTRAPASSA 100% e isso é correto
    expect(macro.percentageSum).toBeCloseTo(300, 2);
  });

  it("CRI IPCA+ carrega crédito, inflação, duration e imobiliário, todos a 100%", () => {
    const macro = deriveDimension(rf("CRI", "IPCA", "CRI"), "MACRO");
    const tags = macro.map((m) => m.tag).sort();

    expect(tags).toEqual([
      "CREDITO_BR", "DURATION_BR", "IMOBILIARIO", "INFLACAO_IPCA", "JUROS_REAL_BR",
    ]);
    for (const m of macro) expect(m.weight).toBe(1);
  });

  it("CDB CDI carrega juro nominal e crédito, sem inflação nem duration real", () => {
    const tags = deriveDimension(rf("CDB", "CDI"), "MACRO").map((m) => m.tag).sort();
    expect(tags).toEqual(["CREDITO_BR", "JUROS_NOMINAL_BR"]);
  });

  it("prefixado carrega duration; pós-fixado não", () => {
    expect(deriveDimension(rf("TESOURO_DIRETO", "PREFIXADO"), "MACRO").map((m) => m.tag).sort())
      .toEqual(["DURATION_BR", "JUROS_NOMINAL_BR"]);
    expect(deriveDimension(rf("TESOURO_DIRETO", "SELIC"), "MACRO").map((m) => m.tag))
      .toEqual(["JUROS_NOMINAL_BR"]);
  });

  it("fundo sem transparência fica NÃO CLASSIFICADO em vez de repartição inventada", () => {
    expect(deriveDimension(rf("FUNDO", "NONE", "Multimercado"), "MACRO").map((m) => m.tag))
      .toEqual(["NAO_CLASSIFICADO"]);
  });
});

describe("inflação vem do INDEXADOR, não do regime tributário", () => {
  function deb(indexador: RateIndex, name: string): AssetTags {
    return {
      assetType: "DEBENTURE",
      assetClass: "RF_BRASIL",
      country: "BR",
      currency: "BRL",
      rawSector: null,
      riskBucket: "DEFENSIVE",
      investmentStyle: "RENDA",
      indexador,
      name,
    };
  }

  it("debênture INCENTIVADA em CDI não carrega inflação", () => {
    const tags = deriveDimension(deb("CDI", "Debênture Incentivada Engie"), "MACRO").map((m) => m.tag);
    expect(tags).not.toContain("INFLACAO_IPCA");
    expect(tags).toContain("JUROS_NOMINAL_BR");
    expect(tags).toContain("CREDITO_BR");
  });

  it("debênture comum em IPCA carrega inflação", () => {
    expect(deriveDimension(deb("IPCA", "Debênture Simples"), "MACRO").map((m) => m.tag))
      .toContain("INFLACAO_IPCA");
  });

  it("o nome do papel não influencia o resultado", () => {
    expect(deriveDimension(deb("CDI", "Debênture Incentivada IPCA Inflação"), "MACRO"))
      .toEqual(deriveDimension(deb("CDI", "XYZ"), "MACRO"));
  });
});

describe("EMISSOR é separado de SETOR", () => {
  function td(): AssetTags {
    return {
      assetType: "TESOURO_DIRETO",
      assetClass: "RF_BRASIL",
      country: "BR",
      currency: "BRL",
      rawSector: "Governo Federal",
      riskBucket: "DEFENSIVE",
      investmentStyle: "RENDA",
      indexador: "IPCA",
      name: "Tesouro IPCA+ 2035",
    };
  }

  it("Tesouro é emissor SOBERANO, não um setor econômico", () => {
    expect(deriveDimension(td(), "EMISSOR")).toEqual([{ tag: "SOBERANO_BR", weight: 1 }]);
    // "Governo Federal" não pode virar concentração setorial
    expect(deriveDimension(td(), "SETOR")).toEqual([{ tag: "NAO_APLICAVEL", weight: 1 }]);
  });

  it("distingue bancário, corporativo e securitizadora", () => {
    const base = td();
    expect(deriveDimension({ ...base, assetType: "CDB" }, "EMISSOR")[0]!.tag).toBe("BANCARIO_BR");
    expect(deriveDimension({ ...base, assetType: "DEBENTURE" }, "EMISSOR")[0]!.tag).toBe("CORPORATIVO_BR");
    expect(deriveDimension({ ...base, assetType: "CRI" }, "EMISSOR")[0]!.tag).toBe("SECURITIZADORA_BR");
    expect(deriveDimension({ ...base, assetType: "FII" }, "EMISSOR")[0]!.tag).toBe("FII_BR");
  });

  it("ETF de Treasury é soberano americano, não corporativo", () => {
    const etf = { ...td(), assetType: "ETF", assetClass: "RF_CAIXA_EXTERIOR" as const, country: "US" };
    expect(deriveDimension(etf, "EMISSOR")[0]!.tag).toBe("SOBERANO_US");
  });
});

describe("SETOR canônico preserva o texto bruto", () => {
  function acao(rawSector: string): AssetTags {
    return {
      assetType: "ACAO",
      assetClass: "ACOES_ETF_EXTERIOR",
      country: "US",
      currency: "USD",
      rawSector,
      riskBucket: "CORE",
      investmentStyle: "BLEND",
      indexador: "NONE",
      name: "Ativo",
    };
  }

  it("normaliza a parte antes da barra", () => {
    expect(deriveDimension(acao("Tecnologia / Internet"), "SETOR")).toEqual([
      { tag: "TECNOLOGIA", weight: 1 },
    ]);
    expect(deriveDimension(acao("Financeiro / Bancos"), "SETOR")).toEqual([
      { tag: "FINANCEIRO", weight: 1 },
    ]);
    expect(deriveDimension(acao("Utilities / Energia Elétrica"), "SETOR")).toEqual([
      { tag: "UTILITIES", weight: 1 },
    ]);
  });

  it("a especialização após a barra vira TEMA sobreposto", () => {
    const temas = deriveDimension(acao("Tecnologia / Semicondutores"), "TEMA").map((t) => t.tag);
    expect(temas).toContain("SEMICONDUTORES");
    expect(temas).toContain("TECNOLOGIA_AI");
  });
});

describe("TEMAS são sobrepostos", () => {
  it("um ativo pode carregar vários temas, cada um por inteiro", () => {
    const asset: AssetTags = {
      assetType: "ETF",
      assetClass: "ACOES_ETF_EXTERIOR",
      country: "US",
      currency: "USD",
      rawSector: "Tecnologia / Semicondutores",
      riskBucket: "CORE",
      investmentStyle: "INDICE",
      indexador: "NONE",
      name: "iShares Semiconductor ETF",
    };
    const temas = deriveDimension(asset, "TEMA");
    expect(temas.length).toBeGreaterThanOrEqual(2);
    for (const t of temas) expect(t.weight).toBe(1);
  });

  it("ativo sem tema identificável devolve lista vazia", () => {
    const asset: AssetTags = {
      assetType: "CDB",
      assetClass: "RF_BRASIL",
      country: "BR",
      currency: "BRL",
      rawSector: null,
      riskBucket: "DEFENSIVE",
      investmentStyle: "RENDA",
      indexador: "CDI",
      name: "CDB",
    };
    expect(deriveDimension(asset, "TEMA")).toEqual([]);
  });
});

describe("pesos somam 1 apenas nas dimensões de partição", () => {
  const tipos = [
    "TESOURO_DIRETO", "CDB", "DEBENTURE", "CRI", "CRA",
    "ACAO", "ETF", "FII", "REIT", "BOND", "FUNDO", "CAIXA",
  ];

  it.each(tipos)("%s", (assetType) => {
    const asset: AssetTags = {
      assetType,
      assetClass: "RF_BRASIL",
      country: "BR",
      currency: "BRL",
      rawSector: null,
      riskBucket: "CORE",
      investmentStyle: "NAO_APLICAVEL",
      indexador: "IPCA",
      name: "Ativo",
    };

    for (const dimension of EXPOSURE_DIMENSIONS) {
      const weights = resolveDimension(asset, dimension, undefined);
      if (DIMENSION_KIND[dimension] === "PARTICAO") {
        expect(weights.reduce((a, x) => a + x.weight, 0)).toBeCloseTo(1, 5);
      } else {
        for (const x of weights) expect(x.weight).toBe(1);
      }
    }
  });
});

describe("consolidação antes de classificar", () => {
  it("soma o mesmo ativo entre corretoras antes de dimensionar", () => {
    const exposures = consolidatePositions(
      [
        { ...GOOGL, brokerId: "avenue", currentPrice: 60_000, averageCost: 60_000 },
        { ...GOOGL, accountId: "acc2", brokerId: "ibkr", currentPrice: 40_000, averageCost: 40_000 },
      ],
      {},
    );
    const tema = computeDimensionalExposure(exposures, new Map(), TIPOS)
      .find((d) => d.dimension === "TEMA")!;
    const tech = tema.buckets.find((b) => b.tag === "TECNOLOGIA_AI")!;

    expect(tech.valueBRL).toBeCloseTo(100_000, 2);
    expect(tech.assetCount).toBe(1);
  });

  it("carteira vazia não produz dimensões", () => {
    expect(computeDimensionalExposure([], new Map(), new Map())).toEqual([]);
  });
});
