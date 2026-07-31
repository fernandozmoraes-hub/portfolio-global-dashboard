import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  consolidatePositions,
  totalFinancialValueBRL,
} from "@/domain/consolidation/consolidate";
import {
  resolveCurrentPortfolio,
  type DatedPosition,
  type ImportMode,
  DEFAULT_STALE_THRESHOLDS,
} from "@/domain/positions/current";
import {
  computeDimensionalExposure,
  type AssetClassification,
} from "@/domain/exposure/compute";
import { evaluateRiskLimits, type RiskLimit } from "@/domain/risk/limits";
import { deriveDimension } from "@/domain/exposure/derive";
import { computeAllocation, type AllocationTarget } from "@/domain/allocation/gap";
import {
  ASSET_CLASS_LABELS,
  RISK_BUCKET_LABELS,
  type AssetClass,
  type RiskBucket,
} from "@/domain/shared/types";
import type { FiiType, RateIndex } from "@/domain/exposure/derive";

/**
 * PREVIEW DA CARTEIRA REAL — Entrega 2.5
 * =======================================
 * Roda o DOMÍNIO REAL sobre o CSV, sem tocar no banco. Nenhuma carga é feita.
 *
 * `risk_bucket` foi preenchido pelo gestor (política de buckets). Nada é
 * inferido automaticamente: o que não estiver na política do gestor permanece
 * NAO_CLASSIFICADO. `investment_style` continua VAZIO por decisão do gestor.
 */

const USDBRL = 5.1193;
const ARQUIVO = "carteira-real-2026-07-30.csv";

const POLITICA: AllocationTarget[] = [
  { assetClass: "RF_BRASIL", targetPercentage: 35, minimumPercentage: 28, maximumPercentage: 42 },
  { assetClass: "ACOES_BRASIL", targetPercentage: 15, minimumPercentage: 10, maximumPercentage: 20 },
  { assetClass: "ACOES_ETF_EXTERIOR", targetPercentage: 30, minimumPercentage: 24, maximumPercentage: 36 },
  { assetClass: "RF_CAIXA_EXTERIOR", targetPercentage: 8, minimumPercentage: 4, maximumPercentage: 12 },
  { assetClass: "FII_IMOBILIARIO", targetPercentage: 9, minimumPercentage: 6, maximumPercentage: 13 },
  { assetClass: "MULTIMERCADO_ALTERNATIVO", targetPercentage: 3, minimumPercentage: 0, maximumPercentage: 6 },
  { assetClass: "CAIXA_BR", targetPercentage: 0, minimumPercentage: 0, maximumPercentage: 3 },
];

/**
 * Tetos individuais POR BUCKET, conforme a política do gestor.
 *
 * CORE tem faixa de atenção explícita (5,00%–5,50%) em vez do padrão de 90% do
 * teto: uma posição core que oscila de 4,9% para 5,1% é ruído de mercado, não
 * decisão de rebalanceamento. Só acima de 5,50% vira violação.
 *
 * TESOURO_DIRETO é isento do teto individual de DEFENSIVE: teto por ativo mede
 * risco de emissor único, e concentrar em NTN-B não é o mesmo risco que
 * concentrar numa empresa. Soberano é monitorado por classe, emissor, duration
 * e vencimento.
 *
 * CASH não tem teto individual — caixa é resultado de decisão de liquidez, não
 * de convicção; o controle dele é a banda de classe (0%–3% para Caixa BR).
 *
 * NAO_CLASSIFICADO não recebe teto: sem bucket definido pelo gestor, o sistema
 * não inventa qual política aplicar.
 */
const LIMITES: RiskLimit[] = [
  { scope: "SINGLE_ASSET", scopeKey: "CORE", maxPercentage: 5.5, warnPercentage: 5 },
  { scope: "SINGLE_ASSET", scopeKey: "GROWTH", maxPercentage: 3 },
  { scope: "SINGLE_ASSET", scopeKey: "SATELLITE", maxPercentage: 2 },
  { scope: "SINGLE_ASSET", scopeKey: "ASYMMETRIC", maxPercentage: 0.5 },
  {
    scope: "SINGLE_ASSET",
    scopeKey: "DEFENSIVE",
    maxPercentage: 3,
    exemptAssetTypes: ["TESOURO_DIRETO"],
  },
  { scope: "SECTOR", scopeKey: null, maxPercentage: 25 },
  { scope: "COUNTRY", scopeKey: "BR", maxPercentage: 70 },
  { scope: "CURRENCY", scopeKey: "BRL", maxPercentage: 75 },

  // ---------------------------------------------------------------------------
  // Tetos AGREGADOS por bucket.
  //
  // Teto individual e teto de bloco medem coisas diferentes. Nenhum ativo
  // defensivo isolado chega a 3%, e ainda assim o bloco defensivo é 60% da
  // carteira — só o limite agregado enxerga isso.
  //
  // CASH é o único com piso: o risco de caixa é faltar, não sobrar. Abaixo de
  // 2% a carteira fica sem colchão para resgate e sem munição para
  // oportunidade, e nenhum teto detectaria isso.
  //
  // As bandas de ALOCAÇÃO por classe (POLITICA) seguem sendo orientação, não
  // obrigação de comprar até o teto — por isso não geram alerta.
  // ---------------------------------------------------------------------------
  { scope: "RISK_BUCKET", scopeKey: "DEFENSIVE", maxPercentage: 65, warnPercentage: 60 },
  { scope: "RISK_BUCKET", scopeKey: "SATELLITE", maxPercentage: 15, warnPercentage: 12 },
  { scope: "RISK_BUCKET", scopeKey: "ASYMMETRIC", maxPercentage: 3, warnPercentage: 2 },
  { scope: "RISK_BUCKET", scopeKey: "CASH", maxPercentage: null, warnBelowPercentage: 2 },
];

/**
 * Modo de importação por conta.
 *
 * Os screenshots de fundos são PARCIAIS: cada arquivo traz alguns fundos, não
 * o retrato completo da conta. Sem essa marcação, o screenshot do Trend em
 * 29/07 apagaria os seis fundos de 28/07.
 */
const MODO_IMPORTACAO: Record<string, ImportMode> = {
  "Fundos BR - screenshots": "PARTIAL_UPDATE",
};

function parseCSV(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  const src = texto.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (aspas) {
      if (c === '"') {
        if (src[i + 1] === '"') { campo += '"'; i += 1; } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || linha.length > 0) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((v) => v.trim() !== ""));
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const RELATORIO = "preview-carteira-real.txt";
writeFileSync(RELATORIO, "");
const log = (s = "") => appendFileSync(RELATORIO, `${s}\n`);

// ---------------------------------------------------------------------------

const linhas = parseCSV(readFileSync(ARQUIVO, "utf8"));
const cab = linhas[0]!.map((h) => h.trim().toLowerCase());
const registros = linhas.slice(1).map((l) => {
  const r: Record<string, string> = {};
  cab.forEach((c, i) => { r[c] = (l[i] ?? "").trim(); });
  return r;
});

const posicoes: DatedPosition[] = registros.map((r) => ({
  accountId: r.account!,
  accountName: r.account!,
  brokerId: r.broker!,
  brokerName: r.broker!,
  assetId: `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`,
  ticker: r.ticker!,
  assetName: r.asset_name!,
  assetClass: r.asset_class as AssetClass,
  // Preservado como veio do gestor. Vazio permanece NAO_CLASSIFICADO.
  riskBucket: (r.risk_bucket || "NAO_CLASSIFICADO") as RiskBucket,
  currency: r.currency as "BRL" | "USD",
  country: r.country!,
  sector: r.sector || null,
  quantity: Number(r.quantity),
  averageCost: r.average_cost ? Number(r.average_cost) : null,
  currentPrice: Number(r.current_price),
  referenceDate: r.reference_date!,
  importMode: MODO_IMPORTACAO[r.account!] ?? "FULL_ACCOUNT_SNAPSHOT",
}));

const setorCanonico = new Map(
  registros.map((r) => [
    `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`,
    deriveDimension(
      {
        assetType: r.asset_type!,
        assetClass: r.asset_class as AssetClass,
        country: r.country!,
        currency: r.currency as "BRL" | "USD",
        rawSector: r.sector || null,
        riskBucket: (r.risk_bucket || "NAO_CLASSIFICADO") as RiskBucket,
        investmentStyle: "NAO_APLICAVEL",
        indexador: (r.indexador || "NONE") as RateIndex,
        fiiType: (r.fii_type || "NAO_APLICAVEL") as FiiType,
        maturityDate: r.maturity_date || null,
        name: r.asset_name!,
      },
      "SETOR",
    )[0]!.tag,
  ]),
);

const tiposPorAtivo = new Map(
  registros.map((r) => [
    `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`,
    r.asset_type!,
  ]),
);

const classificacoes = new Map<string, AssetClassification>(
  registros.map((r) => [
    `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`,
    {
      assetType: r.asset_type!,
      indexador: (r.indexador || "NONE") as RateIndex,
      investmentStyle: r.investment_style || "NAO_APLICAVEL",
      fiiType: (r.fii_type || "NAO_APLICAVEL") as FiiType,
      maturityDate: r.maturity_date || null,
    },
  ]),
);

const FX = { USD: USDBRL };
const HOJE = "2026-07-30";

describe("PREVIEW v2 — carteira real 30/07/2026", () => {
  const current = resolveCurrentPortfolio(
    posicoes, HOJE, FX, DEFAULT_STALE_THRESHOLDS, tiposPorAtivo,
  );
  const exposures = consolidatePositions(current.positions, FX);
  const total = totalFinancialValueBRL(exposures);

  it("patrimônio", () => {
    log("\n═══ PATRIMÔNIO CONSOLIDADO ═══");
    log(`Linhas no CSV .................. ${registros.length}`);
    log(`Posições correntes ............. ${current.positions.length}`);
    log(`Exposições consolidadas ........ ${exposures.length}`);
    log(`USD/BRL ........................ ${USDBRL}`);
    log(`\nPATRIMÔNIO FINANCEIRO .......... ${brl(total)}`);
    const brlT = exposures.filter((e) => e.currency === "BRL").reduce((a, e) => a + e.valueBRL, 0);
    log(`  BRL .......................... ${brl(brlT)}  (${pct((brlT / total) * 100)})`);
    log(`  USD .......................... ${brl(total - brlT)}  (${pct(((total - brlT) / total) * 100)})`);
    expect(total).toBeGreaterThan(900_000);
  });

  /**
   * PARIDADE — critério de aceite da Entrega 2.6 (migração para Lovable Cloud).
   *
   * Estes números congelam o estado aprovado da Entrega 2.5. A migração
   * preserva schema, migrations, RLS, domínio, testes e carteira real; se
   * qualquer um destes valores mudar, a paridade quebrou e a migração não
   * pode ser aceita.
   *
   * As tolerâncias existem só para arredondamento de centavos — não para
   * absorver diferença de resultado.
   */
  it("paridade congelada da Entrega 2.5", () => {
    expect(registros.length).toBe(95);
    expect(current.positions.length).toBe(95);
    expect(exposures.length).toBe(90);
    expect(current.sources.length).toBe(8);
    expect(total).toBeCloseTo(974_877, -1);

    const alertas = evaluateRiskLimits(exposures, LIMITES, tiposPorAtivo, setorCanonico);
    const assinatura = alertas
      .map((a) => `${a.scope}:${a.scopeKey}:${a.severity}:${a.direction}`)
      .sort();

    expect(assinatura).toEqual([
      "COUNTRY:BR:VIOLACAO:TETO",
      "CURRENCY:BRL:ATENCAO:TETO",
      "RISK_BUCKET:CASH:ATENCAO:PISO",
      "RISK_BUCKET:DEFENSIVE:ATENCAO:TETO",
      "RISK_BUCKET:SATELLITE:ATENCAO:TETO",
      "SINGLE_ASSET:CORE:ATENCAO:TETO",
    ]);
  });

  it("freshness com limiares por tipo", () => {
    log("\n═══ FRESHNESS (limiar por tipo de fonte) ═══");
    for (const s of current.sources) {
      log(`${s.referenceDate}  ${String(s.ageDays).padStart(2)}d / limiar ${String(s.staleThresholdDays).padStart(2)}d  ${s.isStale ? "🔴 DEFASADA" : "🟢 ok      "}  ${brl(s.valueBRL).padStart(14)}  ${String(s.positionCount).padStart(2)}p  ${s.brokerName} / ${s.accountName}`);
    }
    log(`\nDatas distintas ${current.hasMixedDates ? "SIM" : "não"} · fonte defasada ${current.hasStaleSources ? "SIM" : "não"} · janela ${current.oldestDate} a ${current.newestDate}`);
    expect(current.sources.length).toBe(8);
  });

  it("alocação", () => {
    log("\n═══ CLASSES × POLÍTICA ═══");
    const alloc = computeAllocation(exposures, POLITICA);
    for (const a of alloc) {
      log(`${ASSET_CLASS_LABELS[a.assetClass].padEnd(30)} ${brl(a.currentValueBRL).padStart(13)}  ${pct(a.currentPercentage).padStart(7)} alvo ${pct(a.targetPercentage).padStart(7)}  gap ${brl(a.gapBRL).padStart(12)}  ${a.status}`);
    }
    expect(alloc).toHaveLength(7);
  });

  it("dimensões", () => {
    const dims = computeDimensionalExposure(exposures, new Map(), classificacoes);
    for (const d of dims) {
      const marca = d.kind === "SOBREPOSICAO" ? " ⚠ SOBREPOSTA (soma > 100% é correto)" : "";
      log(`\n═══ ${d.label.toUpperCase()} ═══  soma ${pct(d.percentageSum)}${marca}`);
      for (const b of d.buckets) {
        log(`   ${b.label.padEnd(38)} ${brl(b.valueBRL).padStart(14)}  ${pct(b.percentage).padStart(7)}  ${String(b.assetCount).padStart(3)}a`);
      }
    }
    expect(dims).toHaveLength(9);
  });

  it("top 10 e alertas", () => {
    log("\n═══ TOP 10 EXPOSIÇÕES CONSOLIDADAS ═══");
    exposures.slice(0, 10).forEach((e, i) => {
      const n = new Set(e.custodies.map((c) => c.brokerName)).size;
      log(`${String(i + 1).padStart(2)}. ${e.ticker.padEnd(20)} ${brl(e.valueBRL).padStart(13)}  ${pct((e.valueBRL / total) * 100).padStart(7)}${n > 1 ? `  (${n} corretoras)` : ""}`);
    });

    log("\n═══ ALERTAS ═══");
    const alertas = evaluateRiskLimits(exposures, LIMITES, tiposPorAtivo, setorCanonico);
    if (alertas.length === 0) log("(nenhum)");
    for (const a of alertas) {
      const faixa =
        a.direction === "PISO"
          ? `piso de vigilância ${pct(a.warnPercentage)} — faltam ${brl(Math.abs(a.excessBRL))}`
          : `atenção ≥ ${pct(a.warnPercentage)} · teto ${a.limitPercentage === null ? "—" : pct(a.limitPercentage)}` +
            (a.severity === "VIOLACAO" ? `   excesso ${brl(a.excessBRL)}` : "");
      const icone = a.severity === "VIOLACAO" ? "🔴" : a.direction === "PISO" ? "🔵" : "🟡";
      log(`${icone} ${a.scope.padEnd(13)} ${(a.scopeKey === a.subject ? a.subject : `${a.subject} [${a.scopeKey}]`).padEnd(32)} ${pct(a.currentPercentage).padStart(7)}   ${faixa}`);
    }

    log("\n═══ EXPOSIÇÃO SOBERANA (monitorada por recorte, não por teto) ═══");
    const soberano = exposures.filter((e) => tiposPorAtivo.get(e.assetId) === "TESOURO_DIRETO");
    const totalSob = soberano.reduce((a, e) => a + e.valueBRL, 0);
    log(`Total Tesouro Nacional ......... ${brl(totalSob)}  ${pct((totalSob / total) * 100)}  em ${soberano.length} papéis`);
    for (const e of soberano.sort((a, b) => b.valueBRL - a.valueBRL)) {
      log(`   ${e.ticker.padEnd(24)} ${brl(e.valueBRL).padStart(13)}  ${pct((e.valueBRL / total) * 100).padStart(7)}`);
    }
    expect(alertas.length).toBeGreaterThanOrEqual(0);
  });

  it("buckets × teto individual e agregado", () => {
    const TETO: Partial<Record<RiskBucket, RiskLimit>> = Object.fromEntries(
      LIMITES.filter((l) => l.scope === "SINGLE_ASSET").map((l) => [l.scopeKey, l]),
    );
    const BLOCO: Partial<Record<RiskBucket, RiskLimit>> = Object.fromEntries(
      LIMITES.filter((l) => l.scope === "RISK_BUCKET").map((l) => [l.scopeKey, l]),
    );

    log("\n═══ RISK BUCKETS × LIMITES ═══");
    const porBucket = new Map<RiskBucket, typeof exposures>();
    for (const e of exposures) {
      const atual = porBucket.get(e.riskBucket) ?? [];
      porBucket.set(e.riskBucket, [...atual, e]);
    }

    const ordem: RiskBucket[] = [
      "CORE", "GROWTH", "SATELLITE", "ASYMMETRIC",
      "DEFENSIVE", "CASH", "NAO_CLASSIFICADO",
    ];

    for (const bucket of ordem) {
      const lista = (porBucket.get(bucket) ?? [])
        .slice()
        .sort((a, b) => b.valueBRL - a.valueBRL);
      if (lista.length === 0) continue;

      const soma = lista.reduce((a, e) => a + e.valueBRL, 0);
      const peso = (soma / total) * 100;
      const limite = TETO[bucket];
      const teto =
        limite && limite.maxPercentage !== null
          ? `teto individual ${pct(limite.maxPercentage)}${limite.warnPercentage !== undefined ? ` (atenção ≥ ${pct(limite.warnPercentage)})` : ""}${limite.exemptAssetTypes?.length ? ` · isento: ${limite.exemptAssetTypes.join(", ")}` : ""}`
          : "sem teto individual";

      log(`\n▸ ${RISK_BUCKET_LABELS[bucket].toUpperCase().padEnd(16)} ${brl(soma).padStart(13)}  ${pct(peso).padStart(7)}  ${String(lista.length).padStart(2)} ativos  —  ${teto}`);

      const bloco = BLOCO[bucket];
      if (bloco) {
        const faixa =
          bloco.maxPercentage === null
            ? `piso de vigilância ${pct(bloco.warnBelowPercentage ?? 0)}`
            : `desejável até ${pct(bloco.warnPercentage ?? 0)} · atenção ${pct(bloco.warnPercentage ?? 0)}–${pct(bloco.maxPercentage)} · hard limit ${pct(bloco.maxPercentage)}`;
        const abaixoDoPiso =
          bloco.warnBelowPercentage !== undefined && peso < bloco.warnBelowPercentage;
        const acimaDoTeto = bloco.maxPercentage !== null && peso > bloco.maxPercentage;
        const emAtencao =
          !acimaDoTeto &&
          bloco.warnPercentage !== undefined &&
          peso >= bloco.warnPercentage;
        const estado = acimaDoTeto
          ? "🔴 acima do hard limit"
          : abaixoDoPiso
            ? "🔵 abaixo do piso"
            : emAtencao
              ? "🟡 em atenção"
              : "🟢 dentro da faixa desejável";
        log(`   bloco: ${faixa}  →  ${estado}`);
      }

      // Isentos não têm teto individual: não devem aparecer como "maior
      // posição" de um limite que não se aplica a eles.
      const sujeitos = lista.filter(
        (e) => !(limite?.exemptAssetTypes ?? []).includes(tiposPorAtivo.get(e.assetId) ?? ""),
      );

      // Só os que chegam perto do teto interessam; o resto é ruído de relatório.
      const tetoMax = limite?.maxPercentage ?? null;
      const relevantes = sujeitos.filter((e) => {
        if (tetoMax === null) return false;
        const p = (e.valueBRL / total) * 100;
        return p >= (limite!.warnPercentage ?? tetoMax * 0.9);
      });

      if (relevantes.length === 0) {
        const maior = sujeitos[0];
        const sufixo = tetoMax !== null ? " — nenhuma na faixa de atenção" : "";
        log(
          maior
            ? `   maior posição sujeita ao teto: ${maior.ticker} ${pct((maior.valueBRL / total) * 100)}${sufixo}`
            : "   nenhuma posição sujeita ao teto individual",
        );
        continue;
      }
      for (const e of relevantes) {
        const p = (e.valueBRL / total) * 100;
        const flag = p > tetoMax! ? "🔴" : "🟡";
        log(`   ${flag} ${e.ticker.padEnd(22)} ${brl(e.valueBRL).padStart(13)}  ${pct(p).padStart(7)}`);
      }
    }

    expect(porBucket.size).toBeGreaterThan(0);
  });

  it("pendências", () => {
    log("\n═══ PENDÊNCIAS ═══");
    log(`risk_bucket vazio .............. ${registros.filter((r) => !r.risk_bucket).length}/${registros.length}`);
    log(`risk_bucket NAO_CLASSIFICADO ... ${registros.filter((r) => (r.risk_bucket || "NAO_CLASSIFICADO") === "NAO_CLASSIFICADO").length}/${registros.length}`);
    log(`investment_style vazio ......... ${registros.filter((r) => !r.investment_style).length}/${registros.length}`);
    log(`average_cost ausente ........... ${registros.filter((r) => !r.average_cost).length}/${registros.length}`);
    const semIdx = registros.filter((r) => ["TESOURO_DIRETO","CDB","DEBENTURE","CRI","CRA","BOND"].includes(r.asset_type!) && !r.indexador);
    log(`renda fixa sem indexador ....... ${semIdx.length} (${semIdx.map((r) => r.ticker).join(", ") || "—"})`);
    const fii = registros.filter((r) => r.asset_type === "FII" && !r.indexador);
    log(`FIIs sem indexador ............. ${fii.length} (papel vs tijolo não distinguível)`);
    expect(registros.length).toBe(95);
  });
});
