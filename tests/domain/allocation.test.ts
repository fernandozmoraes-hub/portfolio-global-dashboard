import { describe, expect, it } from "vitest";
import {
  classifyAllocation,
  computeAllocation,
  targetsSum,
  validatePolicy,
  type AllocationTarget,
} from "@/domain/allocation/gap";
import { suggestNextContribution } from "@/domain/allocation/nextContribution";
import {
  consolidatePositions,
  type PositionInput,
} from "@/domain/consolidation/consolidate";
import type { AssetClass } from "@/domain/shared/types";

/** Política aprovada: Caixa BR com alvo 0% e banda 0-3%. */
const POLITICA: AllocationTarget[] = [
  { assetClass: "RF_BRASIL", targetPercentage: 35, minimumPercentage: 28, maximumPercentage: 42 },
  { assetClass: "ACOES_BRASIL", targetPercentage: 15, minimumPercentage: 10, maximumPercentage: 20 },
  { assetClass: "ACOES_ETF_EXTERIOR", targetPercentage: 30, minimumPercentage: 24, maximumPercentage: 36 },
  { assetClass: "RF_CAIXA_EXTERIOR", targetPercentage: 8, minimumPercentage: 4, maximumPercentage: 12 },
  { assetClass: "FII_IMOBILIARIO", targetPercentage: 9, minimumPercentage: 6, maximumPercentage: 13 },
  { assetClass: "MULTIMERCADO_ALTERNATIVO", targetPercentage: 3, minimumPercentage: 0, maximumPercentage: 6 },
  { assetClass: "CAIXA_BR", targetPercentage: 0, minimumPercentage: 0, maximumPercentage: 3 },
];

function posicao(assetClass: AssetClass, valor: number, id: string): PositionInput {
  return {
    accountId: "acc",
    accountName: "Conta",
    brokerId: "broker",
    brokerName: "Corretora",
    assetId: id,
    ticker: id.toUpperCase(),
    assetName: id,
    assetClass,
    riskBucket: "CORE",
    currency: "BRL",
    country: "BR",
    sector: null,
    quantity: 1,
    averageCost: valor,
    currentPrice: valor,
  };
}

/** Carteira do seed: R$ 1.045.000 distribuídos como no briefing. */
const CARTEIRA_SEED = consolidatePositions(
  [
    posicao("RF_BRASIL", 480_700, "rf"),
    posicao("ACOES_BRASIL", 156_750, "acoes"),
    posicao("ACOES_ETF_EXTERIOR", 209_000, "ext"),
    posicao("RF_CAIXA_EXTERIOR", 31_350, "rfext"),
    posicao("FII_IMOBILIARIO", 135_850, "fii"),
    posicao("MULTIMERCADO_ALTERNATIVO", 31_350, "multi"),
  ],
  {},
);

describe("classificação sobrepeso / neutro / subpeso", () => {
  const alvo: AllocationTarget = {
    assetClass: "RF_BRASIL",
    targetPercentage: 35,
    minimumPercentage: 28,
    maximumPercentage: 42,
  };

  it("acima da banda máxima é SOBREPESO e viola a política", () => {
    const r = classifyAllocation(46, alvo);
    expect(r.status).toBe("SOBREPESO");
    expect(r.severity).toBe("VIOLACAO");
  });

  it("abaixo da banda mínima é SUBPESO e viola a política", () => {
    const r = classifyAllocation(20, alvo);
    expect(r.status).toBe("SUBPESO");
    expect(r.severity).toBe("VIOLACAO");
  });

  it("dentro da banda e longe das bordas é NEUTRO e verde", () => {
    const r = classifyAllocation(35, alvo);
    expect(r.status).toBe("NEUTRO");
    expect(r.severity).toBe("OK");
  });

  it("dentro da banda mas perto da borda gera atenção", () => {
    // banda 28-42, largura 14, margem de atenção = 2,8 p.p.
    expect(classifyAllocation(40, alvo).severity).toBe("ATENCAO");
    expect(classifyAllocation(29, alvo).severity).toBe("ATENCAO");
    expect(classifyAllocation(40, alvo).status).toBe("NEUTRO");
  });

  it("as bordas exatas ainda estão dentro da banda", () => {
    expect(classifyAllocation(42, alvo).status).toBe("NEUTRO");
    expect(classifyAllocation(28, alvo).status).toBe("NEUTRO");
  });
});

describe("gap de alocação sobre a carteira do seed", () => {
  const linhas = computeAllocation(CARTEIRA_SEED, POLITICA);
  const porClasse = new Map(linhas.map((l) => [l.assetClass, l]));

  it("calcula o peso atual de cada classe", () => {
    expect(porClasse.get("RF_BRASIL")!.currentPercentage).toBeCloseTo(46, 2);
    expect(porClasse.get("ACOES_BRASIL")!.currentPercentage).toBeCloseTo(15, 2);
    expect(porClasse.get("ACOES_ETF_EXTERIOR")!.currentPercentage).toBeCloseTo(20, 2);
    expect(porClasse.get("FII_IMOBILIARIO")!.currentPercentage).toBeCloseTo(13, 2);
  });

  it("calcula o gap em pontos percentuais", () => {
    // RF Brasil: 46% atual contra 35% de alvo => +11 p.p.
    expect(porClasse.get("RF_BRASIL")!.gapPercentagePoints).toBeCloseTo(11, 2);
    // Exterior: 20% contra 30% => −10 p.p.
    expect(porClasse.get("ACOES_ETF_EXTERIOR")!.gapPercentagePoints).toBeCloseTo(-10, 2);
    // RF/Caixa exterior: 3% contra 8% => −5 p.p.
    expect(porClasse.get("RF_CAIXA_EXTERIOR")!.gapPercentagePoints).toBeCloseTo(-5, 2);
  });

  it("calcula o gap em reais", () => {
    // Exterior deveria ter 30% de 1.045.000 = 313.500; tem 209.000 => −104.500
    expect(porClasse.get("ACOES_ETF_EXTERIOR")!.gapBRL).toBeCloseTo(-104_500, 2);
    // RF Brasil deveria ter 365.750; tem 480.700 => +114.950
    expect(porClasse.get("RF_BRASIL")!.gapBRL).toBeCloseTo(114_950, 2);
  });

  it("marca RF Brasil como SOBREPESO e o exterior como SUBPESO", () => {
    expect(porClasse.get("RF_BRASIL")!.status).toBe("SOBREPESO");
    expect(porClasse.get("ACOES_ETF_EXTERIOR")!.status).toBe("SUBPESO");
    expect(porClasse.get("RF_CAIXA_EXTERIOR")!.status).toBe("SUBPESO");
    expect(porClasse.get("ACOES_BRASIL")!.status).toBe("NEUTRO");
  });

  it("mostra classe da política sem posição em vez de omiti-la", () => {
    // Caixa BR não tem posição, mas precisa aparecer com 0%
    const caixa = porClasse.get("CAIXA_BR");
    expect(caixa).toBeDefined();
    expect(caixa!.currentValueBRL).toBe(0);
    expect(caixa!.currentPercentage).toBe(0);
    expect(caixa!.status).toBe("NEUTRO");
  });

  it("os gaps em reais somam zero", () => {
    const soma = linhas.reduce((acc, l) => acc + l.gapBRL, 0);
    expect(soma).toBeCloseTo(0, 2);
  });
});

describe("validação da política", () => {
  it("aceita a política aprovada, que soma 100%", () => {
    expect(targetsSum(POLITICA)).toBeCloseTo(100, 4);
    expect(validatePolicy(POLITICA)).toEqual([]);
  });

  it("acusa soma diferente de 100%", () => {
    const quebrada = POLITICA.filter((t) => t.assetClass !== "FII_IMOBILIARIO");
    expect(validatePolicy(quebrada)).toHaveLength(1);
    expect(validatePolicy(quebrada)[0]).toContain("100%");
  });

  it("acusa banda incoerente com o alvo", () => {
    const erros = validatePolicy([
      { assetClass: "RF_BRASIL", targetPercentage: 35, minimumPercentage: 40, maximumPercentage: 42 },
      { assetClass: "ACOES_BRASIL", targetPercentage: 65, minimumPercentage: 60, maximumPercentage: 70 },
    ]);
    expect(erros.some((e) => e.includes("mínima"))).toBe(true);
  });
});

describe("destino sugerido do próximo aporte", () => {
  const linhas = computeAllocation(CARTEIRA_SEED, POLITICA);

  it("prioriza as classes mais subalocadas", () => {
    const plano = suggestNextContribution(linhas, 10_000);

    expect(plano.suggestions.length).toBeGreaterThan(0);
    const primeira = plano.suggestions[0]!;
    expect(["ACOES_ETF_EXTERIOR", "RF_CAIXA_EXTERIOR"]).toContain(
      primeira.assetClass,
    );
  });

  it("sugere apenas CLASSES, nunca ativos", () => {
    const plano = suggestNextContribution(linhas, 10_000);
    for (const s of plano.suggestions) {
      expect(Object.keys(s)).not.toContain("ticker");
      expect(Object.keys(s)).not.toContain("assetId");
    }
  });

  it("nunca sugere aporte em classe sobrealocada", () => {
    const plano = suggestNextContribution(linhas, 10_000);
    const classes = plano.suggestions.map((s) => s.assetClass);
    expect(classes).not.toContain("RF_BRASIL");
  });

  it("distribui exatamente o valor do aporte", () => {
    const plano = suggestNextContribution(linhas, 10_000);
    const distribuido = plano.suggestions.reduce(
      (acc, s) => acc + s.suggestedAmountBRL,
      0,
    );
    expect(distribuido + plano.unallocatedBRL).toBeCloseTo(10_000, 1);
  });

  it("produz um texto de recomendação em português", () => {
    const plano = suggestNextContribution(linhas, 10_000);
    expect(plano.summary).toMatch(/^Priorizar novos aportes em /);
  });

  it("informa quando a carteira já está aderente", () => {
    const aderente = computeAllocation(
      consolidatePositions(
        [
          posicao("RF_BRASIL", 35, "rf"),
          posicao("ACOES_BRASIL", 15, "ac"),
          posicao("ACOES_ETF_EXTERIOR", 30, "ext"),
          posicao("RF_CAIXA_EXTERIOR", 8, "rfext"),
          posicao("FII_IMOBILIARIO", 9, "fii"),
          posicao("MULTIMERCADO_ALTERNATIVO", 3, "multi"),
        ],
        {},
      ),
      POLITICA,
    );

    const plano = suggestNextContribution(aderente, 10_000);
    expect(plano.suggestions).toEqual([]);
    expect(plano.unallocatedBRL).toBeCloseTo(10_000, 2);
    expect(plano.summary).toContain("aderente");
  });

  it("não sugere nada para aporte zero ou negativo", () => {
    expect(suggestNextContribution(linhas, 0).suggestions).toEqual([]);
    expect(suggestNextContribution(linhas, -500).suggestions).toEqual([]);
  });
});
