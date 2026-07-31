import { describe, expect, it } from "vitest";
import { evaluateRiskLimits, type RiskLimit } from "@/domain/risk/limits";
import {
  consolidatePositions,
  type PositionInput,
} from "@/domain/consolidation/consolidate";
import type { RiskBucket } from "@/domain/shared/types";

const LIMITES: RiskLimit[] = [
  { scope: "SINGLE_ASSET", scopeKey: "CORE", maxPercentage: 5 },
  { scope: "SINGLE_ASSET", scopeKey: "GROWTH", maxPercentage: 3 },
  { scope: "SINGLE_ASSET", scopeKey: "ASYMMETRIC", maxPercentage: 0.5 },
  { scope: "SECTOR", scopeKey: null, maxPercentage: 25 },
  { scope: "COUNTRY", scopeKey: "BR", maxPercentage: 70 },
];

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
    riskBucket: "CORE" as RiskBucket,
    currency: "BRL",
    country: "BR",
    sector: "Financeiro",
    quantity: 1,
    averageCost: valor,
    currentPrice: valor,
    ...overrides,
  };
}

describe("limites avaliados sobre a exposição consolidada", () => {
  it("detecta violação que só aparece ao somar as corretoras", () => {
    // GOOGL com 3% na Avenue e 3% na IBKR: nenhuma isolada viola o teto de 5%,
    // mas a exposição consolidada de 6% viola. É o caso que o sistema existe
    // para pegar.
    const posicoes = [
      pos("googl", 30_000, { brokerId: "avenue", brokerName: "Avenue" }),
      pos("googl", 30_000, {
        accountId: "acc2",
        brokerId: "ibkr",
        brokerName: "Interactive Brokers",
      }),
      pos("outros", 940_000, { assetId: "outros", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);
    const googl = alertas.find((a) => a.subject === "GOOGL");

    expect(googl).toBeDefined();
    expect(googl!.severity).toBe("VIOLACAO");
    expect(googl!.currentPercentage).toBeCloseTo(6, 2);
    expect(googl!.maxPercentage).toBe(5);
    expect(googl!.excessPercentagePoints).toBeCloseTo(1, 2);
    // Excesso em R$: 60.000 − 5% de 1.000.000 = 10.000
    expect(googl!.excessBRL).toBeCloseTo(10_000, 2);
  });

  it("não acusa violação quando a soma fica dentro do limite", () => {
    const posicoes = [
      pos("googl", 20_000, { brokerId: "avenue" }),
      pos("googl", 20_000, { accountId: "acc2", brokerId: "ibkr" }),
      pos("outros", 960_000, { assetId: "outros", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);
    const googl = alertas.find((a) => a.subject === "GOOGL");

    expect(googl).toBeUndefined();
  });

  it("aplica teto diferente conforme o risk bucket", () => {
    const posicoes = [
      pos("core1", 45_000, { assetId: "core1", riskBucket: "CORE" }),
      pos("growth1", 45_000, { assetId: "growth1", riskBucket: "GROWTH" }),
      pos("resto", 910_000, { assetId: "resto", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);

    // 4,5% da carteira: dentro do teto de 5% do CORE, acima do teto de 3% do GROWTH
    expect(alertas.find((a) => a.subject === "CORE1")?.severity).not.toBe("VIOLACAO");
    expect(alertas.find((a) => a.subject === "GROWTH1")!.severity).toBe("VIOLACAO");
  });

  it("aplica teto apertado a posições assimétricas", () => {
    const posicoes = [
      pos("assim", 8_000, { assetId: "assim", riskBucket: "ASYMMETRIC" }),
      pos("resto", 992_000, { assetId: "resto", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);
    const assim = alertas.find((a) => a.subject === "ASSIM");

    expect(assim!.severity).toBe("VIOLACAO");
    expect(assim!.currentPercentage).toBeCloseTo(0.8, 2);
  });

  it("emite atenção ao se aproximar do limite sem ultrapassá-lo", () => {
    const posicoes = [
      pos("quase", 48_000, { assetId: "quase", riskBucket: "CORE" }),
      pos("resto", 952_000, { assetId: "resto", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);
    const quase = alertas.find((a) => a.subject === "QUASE");

    // 4,8% está acima de 90% do teto de 5%, mas ainda dentro
    expect(quase!.severity).toBe("ATENCAO");
  });
});

describe("faixa de atenção explícita (ruído de mercado × rebalanceamento)", () => {
  // Política do gestor para ações core: atenção a partir de 5,00%, violação
  // só acima de 5,50%. Sem essa banda, uma posição que oscila em torno de 5%
  // alternaria entre verde e vermelho a cada pregão.
  const CORE_COM_BANDA: RiskLimit[] = [
    { scope: "SINGLE_ASSET", scopeKey: "CORE", maxPercentage: 5.5, warnPercentage: 5 },
  ];

  function carteira(valorDoAtivo: number) {
    return consolidatePositions(
      [
        pos("alvo", valorDoAtivo, { assetId: "alvo", riskBucket: "CORE" }),
        pos("resto", 1_000_000 - valorDoAtivo, {
          assetId: "resto",
          riskBucket: "DEFENSIVE",
        }),
      ],
      {},
    );
  }

  it("fica silencioso abaixo do início da faixa", () => {
    // 4,90% — abaixo de 5,00%. Com o padrão de 90% do teto (4,95%) isso já
    // seria amarelo; a banda explícita é justamente o que evita esse ruído.
    const alertas = evaluateRiskLimits(carteira(49_000), CORE_COM_BANDA);
    expect(alertas.find((a) => a.subject === "ALVO")).toBeUndefined();
  });

  it("emite atenção dentro da faixa, sem tratar como violação", () => {
    const alertas = evaluateRiskLimits(carteira(52_000), CORE_COM_BANDA);
    const alvo = alertas.find((a) => a.subject === "ALVO");

    expect(alvo!.severity).toBe("ATENCAO");
    expect(alvo!.currentPercentage).toBeCloseTo(5.2, 4);
    expect(alvo!.warnPercentage).toBe(5);
    expect(alvo!.maxPercentage).toBe(5.5);
  });

  it("vira violação apenas acima do teto", () => {
    const alertas = evaluateRiskLimits(carteira(56_000), CORE_COM_BANDA);
    const alvo = alertas.find((a) => a.subject === "ALVO");

    expect(alvo!.severity).toBe("VIOLACAO");
    expect(alvo!.currentPercentage).toBeCloseTo(5.6, 4);
    // Excesso em R$: 56.000 − 5,5% de 1.000.000 = 1.000
    expect(alvo!.excessBRL).toBeCloseTo(1_000, 2);
  });

  it("sem warn declarado, mantém o padrão de 90% do teto", () => {
    const semBanda: RiskLimit[] = [
      { scope: "SINGLE_ASSET", scopeKey: "CORE", maxPercentage: 5.5 },
    ];
    // 4,90% fica abaixo do padrão de 4,95% e não alerta; 5,00% já alerta.
    expect(
      evaluateRiskLimits(carteira(49_000), semBanda).find((a) => a.subject === "ALVO"),
    ).toBeUndefined();

    const alvo = evaluateRiskLimits(carteira(50_000), semBanda).find(
      (a) => a.subject === "ALVO",
    );
    expect(alvo!.severity).toBe("ATENCAO");
    expect(alvo!.warnPercentage).toBeCloseTo(4.95, 4);
  });
});

describe("isenção por tipo de ativo", () => {
  const DEFENSIVA: RiskLimit[] = [
    {
      scope: "SINGLE_ASSET",
      scopeKey: "DEFENSIVE",
      maxPercentage: 3,
      exemptAssetTypes: ["TESOURO_DIRETO"],
    },
  ];

  const posicoes = [
    pos("ntnb", 180_000, { assetId: "ntnb", riskBucket: "DEFENSIVE" }),
    pos("fii", 40_000, { assetId: "fii", riskBucket: "DEFENSIVE" }),
    pos("resto", 780_000, { assetId: "resto", riskBucket: "CORE" }),
  ];

  const tipos = new Map([
    ["ntnb", "TESOURO_DIRETO"],
    ["fii", "FII"],
    ["resto", "ACAO"],
  ]);

  it("não aplica teto individual ao tipo isento", () => {
    const alertas = evaluateRiskLimits(
      consolidatePositions(posicoes, {}),
      DEFENSIVA,
      tipos,
    );

    // 18% da carteira num único NTN-B e nenhum alerta: concentração soberana
    // é monitorada por classe, emissor, duration e vencimento — não por teto.
    expect(alertas.find((a) => a.subject === "NTNB")).toBeUndefined();
  });

  it("continua aplicando o teto aos demais ativos do mesmo bucket", () => {
    const alertas = evaluateRiskLimits(
      consolidatePositions(posicoes, {}),
      DEFENSIVA,
      tipos,
    );
    const fii = alertas.find((a) => a.subject === "FII");

    expect(fii!.severity).toBe("VIOLACAO");
    expect(fii!.currentPercentage).toBeCloseTo(4, 4);
  });
});

describe("concentração por dimensão", () => {
  it("acusa concentração setorial acima do teto", () => {
    const posicoes = [
      pos("t1", 300_000, { assetId: "t1", sector: "Tecnologia", riskBucket: "DEFENSIVE" }),
      pos("t2", 700_000, { assetId: "t2", sector: "Financeiro", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);

    expect(alertas.find((a) => a.scope === "SECTOR" && a.subject === "Tecnologia")!.severity)
      .toBe("VIOLACAO");
    expect(alertas.find((a) => a.scope === "SECTOR" && a.subject === "Financeiro")!.severity)
      .toBe("VIOLACAO");
  });

  it("acusa concentração por país", () => {
    const posicoes = [
      pos("br", 800_000, { assetId: "br", country: "BR", riskBucket: "DEFENSIVE" }),
      pos("us", 200_000, { assetId: "us", country: "US", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);
    const brasil = alertas.find((a) => a.scope === "COUNTRY" && a.subject === "BR");

    expect(brasil!.severity).toBe("VIOLACAO");
    expect(brasil!.currentPercentage).toBeCloseTo(80, 2);
  });

  it("classifica setor ausente sem quebrar", () => {
    const posicoes = [
      pos("x", 1_000_000, { assetId: "x", sector: null, riskBucket: "DEFENSIVE" }),
    ];
    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);
    expect(alertas.find((a) => a.subject === "Não classificado")).toBeDefined();
  });

  it("ordena violações antes de atenções", () => {
    const posicoes = [
      pos("v", 300_000, { assetId: "v", sector: "Tecnologia", riskBucket: "DEFENSIVE" }),
      pos("r", 700_000, { assetId: "r", sector: "Saúde", riskBucket: "DEFENSIVE" }),
    ];

    const alertas = evaluateRiskLimits(consolidatePositions(posicoes, {}), LIMITES);
    const severidades = alertas.map((a) => a.severity);
    const primeiraAtencao = severidades.indexOf("ATENCAO");
    const ultimaViolacao = severidades.lastIndexOf("VIOLACAO");

    if (primeiraAtencao !== -1 && ultimaViolacao !== -1) {
      expect(ultimaViolacao).toBeLessThan(primeiraAtencao);
    }
  });

  it("carteira vazia não gera alerta", () => {
    expect(evaluateRiskLimits([], LIMITES)).toEqual([]);
  });
});
