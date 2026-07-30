import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  consolidatePositions,
  totalFinancialValueBRL,
} from "@/domain/consolidation/consolidate";
import {
  resolveCurrentPortfolio,
  type DatedPosition,
} from "@/domain/positions/current";
import {
  computeDimensionalExposure,
  type AssetClassification,
} from "@/domain/exposure/compute";
import { evaluateRiskLimits, type RiskLimit } from "@/domain/risk/limits";
import { computeAllocation, type AllocationTarget } from "@/domain/allocation/gap";
import { ASSET_CLASS_LABELS, type AssetClass } from "@/domain/shared/types";
import type { RateIndex } from "@/domain/exposure/derive";

/**
 * PREVIEW DA CARTEIRA REAL — Entrega 2.5
 * =======================================
 * Roda o DOMÍNIO REAL sobre o CSV, sem tocar no banco. Nenhuma carga é feita.
 *
 * ⚠️ `risk_bucket` e `investment_style` vieram VAZIOS no arquivo, por decisão
 * do gestor. Nada é preenchido automaticamente: as posições entram com o
 * marcador NAO_CLASSIFICADO e os limites que dependem de bucket ficam
 * explicitamente indisponíveis.
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
 * Sem risk_bucket, os tetos por bucket não podem ser avaliados. Aplica-se um
 * teto GLOBAL de 5% por ativo — o mais frouxo da política — para ao menos
 * revelar concentração individual. Os tetos de GROWTH (3%) e ASYMMETRIC (0,5%)
 * ficam pendentes de classificação.
 */
const LIMITES: RiskLimit[] = [
  { scope: "SINGLE_ASSET", scopeKey: null, maxPercentage: 5 },
  { scope: "SECTOR", scopeKey: null, maxPercentage: 25 },
  { scope: "COUNTRY", scopeKey: "BR", maxPercentage: 70 },
  { scope: "CURRENCY", scopeKey: "BRL", maxPercentage: 75 },
];

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
  // NÃO classificado: preservado como veio, sem preenchimento automático.
  riskBucket: (r.risk_bucket || "NAO_CLASSIFICADO") as never,
  currency: r.currency as "BRL" | "USD",
  country: r.country!,
  sector: r.sector || null,
  quantity: Number(r.quantity),
  averageCost: r.average_cost ? Number(r.average_cost) : null,
  currentPrice: Number(r.current_price),
  referenceDate: r.reference_date!,
}));

const classificacoes = new Map<string, AssetClassification>(
  registros.map((r) => [
    `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`,
    {
      assetType: r.asset_type!,
      indexador: (r.indexador || "NONE") as RateIndex,
      investmentStyle: r.investment_style || "NAO_APLICAVEL",
    },
  ]),
);

const FX = { USD: USDBRL };
const HOJE = "2026-07-30";

describe("PREVIEW — carteira real 30/07/2026", () => {
  const current = resolveCurrentPortfolio(posicoes, HOJE, FX);
  const exposures = consolidatePositions(current.positions, FX);
  const total = totalFinancialValueBRL(exposures);

  it("1. patrimônio consolidado", () => {
    log("\n═══ 1. PATRIMÔNIO CONSOLIDADO ═══");
    log(`Linhas no CSV .................. ${registros.length}`);
    log(`Posições correntes ............. ${current.positions.length}`);
    log(`Exposições consolidadas ........ ${exposures.length}`);
    log(`USD/BRL ........................ ${USDBRL}`);
    log(`\nPATRIMÔNIO FINANCEIRO .......... ${brl(total)}`);

    const brlTotal = exposures.filter((e) => e.currency === "BRL").reduce((a, e) => a + e.valueBRL, 0);
    const usdTotal = total - brlTotal;
    log(`  em BRL ....................... ${brl(brlTotal)}  (${pct((brlTotal / total) * 100)})`);
    log(`  em USD ....................... ${brl(usdTotal)}  (${pct((usdTotal / total) * 100)})`);
    log(`  USD nominal .................. US$ ${(usdTotal / USDBRL).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`);
    expect(total).toBeGreaterThan(0);
  });

  it("2. duplicidades entre corretoras", () => {
    log("\n═══ 2. ATIVOS EM MAIS DE UMA CUSTÓDIA ═══");
    const multi = exposures.filter((e) => e.custodies.length > 1);
    if (multi.length === 0) log("(nenhum)");
    for (const e of multi) {
      const corretoras = new Set(e.custodies.map((c) => c.brokerName));
      log(`\n${e.ticker.padEnd(16)} ${brl(e.valueBRL).padStart(14)}  ${pct((e.valueBRL / total) * 100)}  ${corretoras.size > 1 ? "⚠ corretoras distintas" : "(mesma corretora)"}`);
      for (const c of e.custodies) {
        log(`   ${c.brokerName.padEnd(30)} ${c.accountName.padEnd(34)} ${String(c.quantity).padStart(12)} un ${brl(c.valueBRL).padStart(13)}`);
      }
    }
    expect(multi.length).toBeGreaterThan(0);
  });

  it("3. freshness das fontes", () => {
    log("\n═══ 3. FRESHNESS DAS FONTES ═══");
    for (const s of current.sources) {
      log(`${s.referenceDate}  ${String(s.ageDays).padStart(2)}d  ${s.isStale ? "⚠ DEFASADA" : "ok       "}  ${brl(s.valueBRL).padStart(14)}  ${String(s.positionCount).padStart(2)} pos  ${s.brokerName} / ${s.accountName}`);
    }
    log(`\nDatas distintas ................ ${current.hasMixedDates ? "SIM" : "não"}`);
    log(`Alguma fonte defasada .......... ${current.hasStaleSources ? "SIM" : "não"}`);
    log(`Mais antiga .................... ${current.oldestDate}`);
    log(`Mais recente ................... ${current.newestDate}`);
    expect(current.sources.length).toBeGreaterThan(0);
  });

  it("4. classes vs política", () => {
    log("\n═══ 4. CLASSES × POLÍTICA ═══");
    const alloc = computeAllocation(exposures, POLITICA);
    log("Classe                          Valor          Atual    Alvo    Banda        Gap R$        Status");
    for (const a of alloc) {
      log(
        `${ASSET_CLASS_LABELS[a.assetClass].padEnd(30)} ${brl(a.currentValueBRL).padStart(13)}  ${pct(a.currentPercentage).padStart(7)} ${pct(a.targetPercentage).padStart(7)}  ${`${a.minimumPercentage}-${a.maximumPercentage}%`.padStart(9)}  ${brl(a.gapBRL).padStart(13)}  ${a.status}`,
      );
    }
    expect(alloc.length).toBe(7);
  });

  it("5-8. dimensões (país, moeda, setor, macro, estilo, bucket)", () => {
    const dims = computeDimensionalExposure(exposures, new Map(), classificacoes);
    for (const d of dims) {
      log(`\n═══ ${d.label.toUpperCase()} ═══   (${d.question})`);
      for (const b of d.buckets) {
        log(`   ${b.label.padEnd(32)} ${brl(b.valueBRL).padStart(14)}  ${pct(b.percentage).padStart(7)}  ${String(b.assetCount).padStart(3)} ativos`);
      }
    }
    expect(dims).toHaveLength(7);
  });

  it("9. top 10 e alertas de concentração", () => {
    log("\n═══ TOP 10 EXPOSIÇÕES CONSOLIDADAS ═══");
    exposures.slice(0, 10).forEach((e, i) => {
      const n = e.custodies.length > 1 ? ` (${new Set(e.custodies.map((c) => c.brokerName)).size} corretora(s), ${e.custodies.length} contas)` : "";
      log(`${String(i + 1).padStart(2)}. ${e.ticker.padEnd(18)} ${brl(e.valueBRL).padStart(14)}  ${pct((e.valueBRL / total) * 100).padStart(7)}${n}`);
    });

    log("\n═══ ALERTAS DE CONCENTRAÇÃO ═══");
    const alertas = evaluateRiskLimits(exposures, LIMITES);
    if (alertas.length === 0) log("(nenhum)");
    for (const a of alertas) {
      log(`${a.severity === "VIOLACAO" ? "🔴" : "🟡"} ${a.scope.padEnd(13)} ${a.subject.padEnd(34)} ${pct(a.currentPercentage).padStart(7)} de ${pct(a.maxPercentage)}  excesso ${brl(Math.max(0, a.excessBRL))}`);
    }
    expect(alertas.length).toBeGreaterThanOrEqual(0);
  });

  it("pendências de classificação", () => {
    log("\n═══ PENDÊNCIAS ═══");
    const semBucket = registros.filter((r) => !r.risk_bucket).length;
    const semEstilo = registros.filter((r) => !r.investment_style).length;
    const semCusto = registros.filter((r) => !r.average_cost).length;
    const semIndexador = registros.filter(
      (r) => ["TESOURO_DIRETO", "CDB", "DEBENTURE", "CRI", "CRA", "BOND"].includes(r.asset_type!) && !r.indexador,
    );
    log(`risk_bucket vazio .............. ${semBucket}/${registros.length} linhas (preservado, não preenchido)`);
    log(`investment_style vazio ......... ${semEstilo}/${registros.length} linhas (preservado, não preenchido)`);
    log(`average_cost ausente ........... ${semCusto}/${registros.length} linhas`);
    log(`renda fixa sem indexador ....... ${semIndexador.length} (${semIndexador.map((r) => r.ticker).join(", ") || "—"})`);

    const brokers = [...new Set(registros.map((r) => r.broker))];
    log(`\nCorretoras provisórias (A_CONFIRMAR):`);
    brokers.filter((b) => b!.includes("A_CONFIRMAR")).forEach((b) => log(`   ${b}`));
    log(`Corretoras definitivas:`);
    brokers.filter((b) => !b!.includes("A_CONFIRMAR")).forEach((b) => log(`   ${b}`));
    expect(brokers.length).toBeGreaterThan(0);
  });
});

describe("DIAGNÓSTICO — linhas descartadas pela regra de snapshot completo", () => {
  const current = resolveCurrentPortfolio(posicoes, HOJE, FX);
  const total = totalFinancialValueBRL(consolidatePositions(current.positions, FX));

  it("mostra o que a regra por conta descartou", () => {
    const porConta = new Map<string, Map<string, number>>();
    for (const p of posicoes) {
      const m = porConta.get(p.accountId) ?? new Map<string, number>();
      m.set(p.referenceDate, (m.get(p.referenceDate) ?? 0) + 1);
      porConta.set(p.accountId, m);
    }

    log("\n═══ DIAGNÓSTICO: DATAS POR CONTA ═══");
    for (const [conta, datas] of porConta) {
      if (datas.size > 1) {
        const ordenadas = [...datas.entries()].sort();
        const ultima = ordenadas.at(-1)!;
        log(`\n⚠ ${conta}`);
        for (const [d, n] of ordenadas) {
          log(`   ${d}  ${String(n).padStart(2)} posições  ${d === ultima[0] ? "<- usada (mais recente)" : "<- DESCARTADA"}`);
        }
      }
    }

    const descartadas = posicoes.filter(
      (p) => !current.positions.some((c) => c.accountId === p.accountId && c.assetId === p.assetId),
    );
    log(`\nPosições descartadas: ${descartadas.length}`);
    let valorDescartado = 0;
    for (const d of descartadas) {
      const v = d.quantity * d.currentPrice * (d.currency === "BRL" ? 1 : USDBRL);
      valorDescartado += v;
      log(`   ${d.referenceDate}  ${d.ticker.padEnd(24)} ${brl(v).padStart(12)}  ${d.assetClass}`);
    }
    log(`\nValor não computado ............ ${brl(valorDescartado)}`);
    log(`Patrimônio com regra estrita ... ${brl(total)}`);
    log(`Patrimônio com carry-forward ... ${brl(total + valorDescartado)}`);
    expect(descartadas.length).toBeGreaterThanOrEqual(0);
  });
});
