"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PortfolioRow } from "@/services/portfolio";
import { Badge } from "@/components/ui/badge";
import {
  ASSET_CLASS_LABELS,
  RISK_BUCKET_LABELS,
  type AssetClass,
  type RiskBucket,
} from "@/domain/shared/types";
import {
  formatBRL,
  formatOrDash,
  formatPercent,
  NO_DATA,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Tabela consolidada da carteira.
 *
 * Cada linha é uma EXPOSIÇÃO ECONÔMICA, não uma posição de corretora. A coluna
 * "Corretoras" mostra onde aquela exposição está custodiada — quando traz mais
 * de um nome, é exatamente o caso que a leitura por corretora esconderia.
 *
 * Ordenação e filtro rodam no cliente: o volume é de dezenas de linhas, e uma
 * ida ao servidor por clique de coluna seria latência sem contrapartida.
 */

type SortKey = "ticker" | "valueBRL" | "weight" | "unrealizedResultPercent";

export function PortfolioTable({ rows }: { rows: readonly PortfolioRow[] }) {
  const [search, setSearch] = useState("");
  const [assetClass, setAssetClass] = useState<string>("TODAS");
  const [sortKey, setSortKey] = useState<SortKey>("valueBRL");
  const [ascending, setAscending] = useState(false);

  const classes = useMemo(
    () => [...new Set(rows.map((row) => row.assetClass))],
    [rows],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      const matchesClass =
        assetClass === "TODAS" || row.assetClass === assetClass;
      if (!matchesClass) return false;
      if (term === "") return true;
      return (
        row.ticker.toLowerCase().includes(term) ||
        row.assetName.toLowerCase().includes(term) ||
        row.brokers.some((broker) => broker.toLowerCase().includes(term))
      );
    });

    return [...filtered].sort((a, b) => {
      const direction = ascending ? 1 : -1;
      if (sortKey === "ticker") {
        return a.ticker.localeCompare(b.ticker, "pt-BR") * direction;
      }
      // Valores nulos (custo desconhecido) vão sempre para o fim.
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * direction;
    });
  }, [rows, search, assetClass, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((value) => !value);
    } else {
      setSortKey(key);
      setAscending(key === "ticker");
    }
  }

  const totalVisible = visible.reduce((acc, row) => acc + row.valueBRL, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por ticker, nome ou corretora…"
          aria-label="Buscar ativo"
          className="h-9 min-w-56 flex-1 rounded-md border border-[var(--input)] bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <select
          value={assetClass}
          onChange={(event) => setAssetClass(event.target.value)}
          aria-label="Filtrar por classe"
          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <option value="TODAS">Todas as classes</option>
          {classes.map((value) => (
            <option key={value} value={value}>
              {ASSET_CLASS_LABELS[value as AssetClass] ?? value}
            </option>
          ))}
        </select>
        <span className="tabular text-sm text-[var(--muted-foreground)]">
          {visible.length} de {rows.length} · {formatBRL(totalVisible)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full min-w-4xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--muted)] text-left">
              <Th onClick={() => toggleSort("ticker")} active={sortKey === "ticker"} asc={ascending}>
                Ticker
              </Th>
              <Th>Nome</Th>
              <Th>Classe</Th>
              <Th>Setor</Th>
              <Th>País</Th>
              <Th>Moeda</Th>
              <Th>Corretoras</Th>
              <Th numeric onClick={() => toggleSort("valueBRL")} active={sortKey === "valueBRL"} asc={ascending}>
                Valor
              </Th>
              <Th numeric onClick={() => toggleSort("weight")} active={sortKey === "weight"} asc={ascending}>
                % carteira
              </Th>
              <Th numeric>Custo médio</Th>
              <Th
                numeric
                onClick={() => toggleSort("unrealizedResultPercent")}
                active={sortKey === "unrealizedResultPercent"}
                asc={ascending}
              >
                Resultado
              </Th>
              <Th>Bucket</Th>
              <Th numeric>Peso máx.</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.assetId}
                className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]"
              >
                <td className="px-3 py-2.5 font-medium">
                  <Link
                    href={`/carteira/${row.assetId}`}
                    className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    {row.ticker}
                  </Link>
                </td>
                <td className="max-w-56 truncate px-3 py-2.5" title={row.assetName}>
                  {row.assetName}
                </td>
                <td className="px-3 py-2.5 text-[var(--muted-foreground)]">
                  {ASSET_CLASS_LABELS[row.assetClass as AssetClass] ?? row.assetClass}
                </td>
                <td className="px-3 py-2.5 text-[var(--muted-foreground)]">
                  {row.sector ?? NO_DATA}
                </td>
                <td className="px-3 py-2.5">{row.country}</td>
                <td className="px-3 py-2.5">{row.currency}</td>
                <td className="px-3 py-2.5">
                  {row.brokers.length > 1 ? (
                    <Badge variant="neutral" title={row.brokers.join(" · ")}>
                      {row.brokers.length} corretoras
                    </Badge>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">
                      {row.brokers[0] ?? NO_DATA}
                    </span>
                  )}
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  {formatBRL(row.valueBRL)}
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  {formatPercent(row.weight, 2)}
                </td>
                <td className="tabular px-3 py-2.5 text-right text-[var(--muted-foreground)]">
                  {formatOrDash(row.averageCost, (v) =>
                    v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
                  )}
                </td>
                <td
                  className={cn(
                    "tabular px-3 py-2.5 text-right",
                    row.unrealizedResultPercent !== null &&
                      (row.unrealizedResultPercent >= 0
                        ? "text-[var(--status-ok)]"
                        : "text-[var(--status-violation)]"),
                  )}
                >
                  {formatOrDash(row.unrealizedResultPercent, (v) =>
                    formatPercent(v, 1),
                  )}
                </td>
                <td className="px-3 py-2.5 text-[var(--muted-foreground)]">
                  {RISK_BUCKET_LABELS[row.riskBucket as RiskBucket] ?? row.riskBucket}
                </td>
                <td className="tabular px-3 py-2.5 text-right text-[var(--muted-foreground)]">
                  {formatOrDash(row.maxWeight, (v) => formatPercent(v, 1))}
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    variant={
                      row.severity === "VIOLACAO"
                        ? "violation"
                        : row.severity === "ATENCAO"
                          ? "attention"
                          : "ok"
                    }
                  >
                    {row.severity === "VIOLACAO"
                      ? "Fora"
                      : row.severity === "ATENCAO"
                        ? "Atenção"
                        : "Ok"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
          Nenhum ativo corresponde aos filtros.
        </p>
      ) : null}
    </div>
  );
}

function Th({
  children,
  numeric,
  onClick,
  active,
  asc,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  onClick?: () => void;
  active?: boolean;
  asc?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2.5 text-xs font-medium text-[var(--muted-foreground)]",
        numeric && "text-right",
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="rounded-sm outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {children}
          <span aria-hidden className="ml-1">
            {active ? (asc ? "↑" : "↓") : ""}
          </span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}
