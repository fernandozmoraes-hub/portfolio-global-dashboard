#!/usr/bin/env node
/**
 * IMPORTAÇÃO DA CARTEIRA REAL (Entrega 2.5)
 * ==========================================
 *
 * Lê um CSV de posições e gera o SQL de carga, validando antes de gerar.
 * Existe porque o Import Center com interface só chega na Entrega 4 — e a
 * carteira real precisa entrar antes disso, para validar Dashboard e Carteira
 * com dados de verdade.
 *
 * USO
 *   node scripts/importar-carteira.mjs carteira.csv --usdbrl 5.42 > carga.sql
 *   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f carga.sql
 *
 * OPÇÕES
 *   --usdbrl <taxa>     cotação USD/BRL da data de referência (obrigatória se
 *                       houver qualquer posição em USD)
 *   --eurbrl <taxa>     idem para EUR
 *   --user <uuid>       usuário alvo (padrão: o mais antigo em auth.users)
 *   --validar           só valida e reporta, sem gerar SQL
 *
 * O SQL gerado é IDEMPOTENTE: reexecutar atualiza em vez de duplicar.
 * Nenhum ativo criado por aqui recebe is_demo — a carteira real nunca se
 * mistura com o seed demonstrativo.
 */

import { readFileSync } from "node:fs";

const COLUNAS = [
  "broker",
  "account",
  "ticker",
  "asset_name",
  "exchange",
  "asset_type",
  "asset_class",
  "country",
  "currency",
  "sector",
  "risk_bucket",
  "quantity",
  "average_cost",
  "current_price",
  "reference_date",
];

const OBRIGATORIAS = [
  "broker",
  "account",
  "ticker",
  "asset_name",
  "asset_class",
  "country",
  "currency",
  "risk_bucket",
  "quantity",
  "current_price",
  "reference_date",
];

const ASSET_CLASSES = new Set([
  "RF_BRASIL", "ACOES_BRASIL", "ACOES_ETF_EXTERIOR", "RF_CAIXA_EXTERIOR",
  "FII_IMOBILIARIO", "MULTIMERCADO_ALTERNATIVO", "CAIXA_BR",
]);
const ASSET_TYPES = new Set([
  "ACAO", "ETF", "FII", "TESOURO_DIRETO", "CDB", "LCI_LCA", "DEBENTURE",
  "CRI", "CRA", "FUNDO", "BOND", "REIT", "CAIXA",
]);
const RISK_BUCKETS = new Set([
  "CORE", "GROWTH", "SATELLITE", "ASYMMETRIC", "DEFENSIVE", "CASH",
]);
const CURRENCIES = new Set(["BRL", "USD", "EUR"]);

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Parser que respeita aspas e vírgula dentro de campo. */
function parseCSV(texto) {
  const linhas = [];
  let campo = "";
  let linha = [];
  let dentroDeAspas = false;

  const conteudo = texto.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo[i];

    if (dentroDeAspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { campo += '"'; i += 1; }
        else dentroDeAspas = false;
      } else campo += c;
      continue;
    }

    if (c === '"') dentroDeAspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }

  if (campo !== "" || linha.length > 0) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((v) => v.trim() !== ""));
}

function q(valor) {
  if (valor === null || valor === undefined || valor === "") return "null";
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function numero(valor) {
  if (valor === undefined || valor === null) return null;
  // Aceita "1.234,56" (pt-BR) e "1234.56"
  const limpo = String(valor).trim().replace(/\s/g, "");
  if (limpo === "") return null;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function validar(registros) {
  const erros = [];
  const avisos = [];
  const vistos = new Set();

  registros.forEach((r, i) => {
    const linha = i + 2; // +1 do cabeçalho, +1 para base 1

    for (const campo of OBRIGATORIAS) {
      if (!r[campo] || String(r[campo]).trim() === "") {
        erros.push(`linha ${linha}: campo obrigatório vazio — ${campo}`);
      }
    }

    if (r.asset_class && !ASSET_CLASSES.has(r.asset_class))
      erros.push(`linha ${linha}: asset_class inválida — "${r.asset_class}"`);
    if (r.asset_type && !ASSET_TYPES.has(r.asset_type))
      erros.push(`linha ${linha}: asset_type inválido — "${r.asset_type}"`);
    if (r.risk_bucket && !RISK_BUCKETS.has(r.risk_bucket))
      erros.push(`linha ${linha}: risk_bucket inválido — "${r.risk_bucket}"`);
    if (r.currency && !CURRENCIES.has(r.currency))
      erros.push(`linha ${linha}: moeda não suportada — "${r.currency}"`);

    const qtd = numero(r.quantity);
    if (qtd === null) erros.push(`linha ${linha}: quantidade não numérica — "${r.quantity}"`);
    else if (qtd < 0) erros.push(`linha ${linha}: quantidade negativa`);
    else if (qtd === 0) avisos.push(`linha ${linha}: quantidade zero (${r.ticker})`);

    const preco = numero(r.current_price);
    if (preco === null) erros.push(`linha ${linha}: preço não numérico — "${r.current_price}"`);
    else if (preco < 0) erros.push(`linha ${linha}: preço negativo`);

    if (r.average_cost && numero(r.average_cost) === null)
      erros.push(`linha ${linha}: custo médio não numérico — "${r.average_cost}"`);

    if (r.reference_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.reference_date.trim()))
      erros.push(`linha ${linha}: data deve ser AAAA-MM-DD — "${r.reference_date}"`);

    // Duplicidade: mesma conta + mesmo ticker + mesma data
    const chave = `${r.account}|${r.ticker}|${r.exchange || "N/A"}|${r.currency}|${r.reference_date}`;
    if (vistos.has(chave)) {
      erros.push(`linha ${linha}: posição duplicada — ${r.ticker} em ${r.account}`);
    }
    vistos.add(chave);
  });

  return { erros, avisos };
}

// ---------------------------------------------------------------------------
// Geração de SQL
// ---------------------------------------------------------------------------

function gerarSQL(registros, opcoes) {
  const brokers = [...new Set(registros.map((r) => r.broker))];
  const contas = [
    ...new Map(
      registros.map((r) => [r.account, { nome: r.account, broker: r.broker, moeda: r.currency }]),
    ).values(),
  ];
  const ativos = [
    ...new Map(
      registros.map((r) => [
        `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`,
        r,
      ]),
    ).values(),
  ];
  const dataRef = registros[0].reference_date.trim();

  const out = [];
  out.push(`-- Carga da CARTEIRA REAL gerada por scripts/importar-carteira.mjs`);
  out.push(`-- Data de referência: ${dataRef}`);
  out.push(`-- ${registros.length} posições · ${ativos.length} ativos · ${brokers.length} corretoras`);
  out.push(`-- Idempotente: reexecutar atualiza, não duplica.`);
  out.push(`\nbegin;\n`);
  out.push(`do $$\ndeclare\n  v_user uuid;\nbegin`);
  out.push(`  v_user := coalesce(${opcoes.user ? `'${opcoes.user}'::uuid` : "null"},`);
  out.push(`    nullif(current_setting('app.seed_user_id', true), '')::uuid,`);
  out.push(`    (select id from auth.users order by created_at limit 1));`);
  out.push(`  if v_user is null then`);
  out.push(`    raise exception 'Nenhum usuário encontrado. Faça login na aplicação uma vez antes de importar.';`);
  out.push(`  end if;\n`);

  // Câmbio
  const moedas = new Set(registros.map((r) => r.currency));
  for (const [moeda, taxa] of Object.entries(opcoes.fx)) {
    if (!moedas.has(moeda)) continue;
    out.push(`  insert into fx_rates (id, user_id, date, currency_from, currency_to, rate, source)`);
    out.push(`  values (md5(v_user::text||'fx:real:${moeda}:${dataRef}')::uuid, v_user, '${dataRef}', '${moeda}', 'BRL', ${taxa}, 'importacao')`);
    out.push(`  on conflict (id) do update set rate = excluded.rate;\n`);
  }

  // Corretoras
  for (const b of brokers) {
    const pais = registros.find((r) => r.broker === b)?.country === "BR" ? "BR" : "US";
    const moeda = registros.find((r) => r.broker === b)?.currency ?? "BRL";
    out.push(`  insert into brokers (id, user_id, name, country, base_currency)`);
    out.push(`  values (md5(v_user::text||'broker:${b}')::uuid, v_user, ${q(b)}, '${pais}', '${moeda}')`);
    out.push(`  on conflict (id) do nothing;`);
  }
  out.push("");

  // Contas
  for (const c of contas) {
    out.push(`  insert into accounts (id, user_id, broker_id, name, currency)`);
    out.push(`  values (md5(v_user::text||'account:${c.nome}')::uuid, v_user, md5(v_user::text||'broker:${c.broker}')::uuid, ${q(c.nome)}, '${c.moeda}')`);
    out.push(`  on conflict (id) do nothing;`);
  }
  out.push("");

  // Ativos — is_demo FALSE: carteira real
  for (const a of ativos) {
    const chave = `${a.ticker}|${a.exchange || "N/A"}|${a.currency}`;
    out.push(`  insert into assets (id, user_id, ticker, name, exchange, asset_type, asset_class, country, currency, sector, risk_bucket, is_demo)`);
    out.push(`  values (md5(v_user::text||'asset:${chave}')::uuid, v_user, ${q(a.ticker)}, ${q(a.asset_name)}, ${q(a.exchange || "N/A")}, '${a.asset_type || "ACAO"}', '${a.asset_class}', ${q(a.country)}, '${a.currency}', ${q(a.sector)}, '${a.risk_bucket}', false)`);
    out.push(`  on conflict (id) do update set asset_class = excluded.asset_class, risk_bucket = excluded.risk_bucket, sector = excluded.sector;`);
  }
  out.push("");

  // Posições
  for (const r of registros) {
    const chave = `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`;
    const custo = numero(r.average_cost);
    out.push(`  insert into positions (id, user_id, account_id, asset_id, quantity, average_cost, current_price, reference_date)`);
    out.push(`  values (md5(v_user::text||'pos:${r.account}:${chave}:${r.reference_date}')::uuid, v_user, md5(v_user::text||'account:${r.account}')::uuid, md5(v_user::text||'asset:${chave}')::uuid, ${numero(r.quantity)}, ${custo === null ? "null" : custo}, ${numero(r.current_price)}, '${r.reference_date.trim()}')`);
    out.push(`  on conflict (id) do update set quantity = excluded.quantity, average_cost = excluded.average_cost, current_price = excluded.current_price;`);
  }

  out.push(`\n  raise notice 'Carteira real importada: % posições em %', ${registros.length}, '${dataRef}';`);
  out.push(`end;\n$$;\n`);
  out.push(`commit;`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const arquivo = args.find((a) => !a.startsWith("--"));

  if (!arquivo) {
    console.error("uso: node scripts/importar-carteira.mjs <arquivo.csv> [--usdbrl 5.42] [--validar]");
    process.exit(1);
  }

  const opcoes = {
    fx: {},
    user: null,
    validarApenas: args.includes("--validar"),
  };
  const idxUsd = args.indexOf("--usdbrl");
  if (idxUsd !== -1) opcoes.fx.USD = numero(args[idxUsd + 1]);
  const idxEur = args.indexOf("--eurbrl");
  if (idxEur !== -1) opcoes.fx.EUR = numero(args[idxEur + 1]);
  const idxUser = args.indexOf("--user");
  if (idxUser !== -1) opcoes.user = args[idxUser + 1];

  const linhas = parseCSV(readFileSync(arquivo, "utf8"));
  if (linhas.length < 2) {
    console.error("CSV vazio ou só com cabeçalho.");
    process.exit(1);
  }

  const cabecalho = linhas[0].map((h) => h.trim().toLowerCase());
  const faltantes = OBRIGATORIAS.filter((c) => !cabecalho.includes(c));
  if (faltantes.length > 0) {
    console.error(`Colunas obrigatórias ausentes: ${faltantes.join(", ")}`);
    console.error(`Cabeçalho esperado: ${COLUNAS.join(",")}`);
    process.exit(1);
  }

  const registros = linhas.slice(1).map((l) => {
    const r = {};
    cabecalho.forEach((c, i) => { r[c] = (l[i] ?? "").trim(); });
    return r;
  });

  const { erros, avisos } = validar(registros);

  // Câmbio obrigatório quando há moeda estrangeira
  for (const moeda of new Set(registros.map((r) => r.currency))) {
    if (moeda !== "BRL" && !opcoes.fx[moeda]) {
      erros.push(`Há posições em ${moeda} mas a cotação não foi informada (use --${moeda.toLowerCase()}brl).`);
    }
  }

  const log = (msg) => console.error(msg);

  if (avisos.length > 0) {
    log(`\n⚠  ${avisos.length} aviso(s):`);
    avisos.forEach((a) => log(`   ${a}`));
  }

  if (erros.length > 0) {
    log(`\n✗  ${erros.length} erro(s) — nada foi gerado:\n`);
    erros.forEach((e) => log(`   ${e}`));
    process.exit(1);
  }

  // Resumo de conferência
  const total = registros.reduce((acc, r) => {
    const taxa = r.currency === "BRL" ? 1 : opcoes.fx[r.currency];
    return acc + numero(r.quantity) * numero(r.current_price) * taxa;
  }, 0);

  const porClasse = {};
  for (const r of registros) {
    const taxa = r.currency === "BRL" ? 1 : opcoes.fx[r.currency];
    porClasse[r.asset_class] = (porClasse[r.asset_class] ?? 0) +
      numero(r.quantity) * numero(r.current_price) * taxa;
  }

  const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  log(`\n✓  ${registros.length} posições válidas`);
  log(`   Patrimônio consolidado: ${brl(total)}`);
  log(`\n   Por classe:`);
  Object.entries(porClasse)
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, v]) => log(`     ${c.padEnd(26)} ${brl(v).padStart(16)}  ${((v / total) * 100).toFixed(1)}%`));

  // Ativos em mais de uma corretora — o princípio fundamental
  const porAtivo = {};
  for (const r of registros) {
    const k = `${r.ticker}|${r.exchange || "N/A"}|${r.currency}`;
    (porAtivo[k] ??= new Set()).add(r.broker);
  }
  const repetidos = Object.entries(porAtivo).filter(([, s]) => s.size > 1);
  if (repetidos.length > 0) {
    log(`\n   Ativos custodiados em mais de uma corretora:`);
    repetidos.forEach(([k, s]) => log(`     ${k.split("|")[0].padEnd(12)} ${[...s].join(" · ")}`));
  }

  if (opcoes.validarApenas) {
    log(`\n(--validar: SQL não gerado)`);
    return;
  }

  console.log(gerarSQL(registros, opcoes));
  log(`\n→ SQL gerado. Aplique com:\n   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f carga.sql\n`);
}

main();
