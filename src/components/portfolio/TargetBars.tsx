import type { ClassAllocation } from "@/domain/allocation/gap";
import { ASSET_CLASS_LABELS } from "@/domain/shared/types";
import { formatBRL, formatPercent, formatPercentagePoints } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

/**
 * Atual × Alvo, com a banda de política desenhada ao fundo.
 *
 * A faixa clara é a banda [mínimo, máximo]; o traço vertical é o alvo; a barra
 * é a posição atual. Assim dá para ver de relance não só o desvio, mas se ele
 * ainda está dentro do que a política tolera.
 */
export function TargetBars({ rows }: { rows: readonly ClassAllocation[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Nenhuma política de alocação cadastrada.
      </p>
    );
  }

  // Escala comum a todas as linhas, para que as barras sejam comparáveis.
  const scale = Math.max(
    ...rows.map((row) => Math.max(row.currentPercentage, row.maximumPercentage)),
    10,
  );

  return (
    <ul className="flex flex-col gap-5">
      {rows.map((row) => {
        const pct = (value: number) => `${(value / scale) * 100}%`;
        const barColor =
          row.severity === "VIOLACAO"
            ? "var(--status-violation)"
            : row.severity === "ATENCAO"
              ? "var(--status-attention)"
              : "var(--status-ok)";

        return (
          <li key={row.assetClass} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                {ASSET_CLASS_LABELS[row.assetClass]}
              </span>
              <span className="tabular flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                <span>
                  Atual{" "}
                  <strong className="text-[var(--foreground)]">
                    {formatPercent(row.currentPercentage)}
                  </strong>
                </span>
                <span>Alvo {formatPercent(row.targetPercentage)}</span>
                <StatusBadge status={row.status} severity={row.severity} />
              </span>
            </div>

            <div className="relative h-5 w-full rounded-sm bg-[var(--muted)]">
              {/* banda tolerada pela política */}
              <div
                className="absolute inset-y-0 rounded-sm bg-[var(--secondary)]"
                style={{
                  left: pct(row.minimumPercentage),
                  width: pct(row.maximumPercentage - row.minimumPercentage),
                }}
                aria-hidden
              />
              {/* posição atual */}
              <div
                className="absolute inset-y-1 rounded-sm opacity-90"
                style={{ width: pct(row.currentPercentage), backgroundColor: barColor }}
                aria-hidden
              />
              {/* alvo */}
              <div
                className="absolute inset-y-0 w-0.5 bg-[var(--foreground)]"
                style={{ left: pct(row.targetPercentage) }}
                aria-hidden
              />
            </div>

            <div className="tabular flex justify-between text-xs text-[var(--muted-foreground)]">
              <span>
                Banda {formatPercent(row.minimumPercentage)} –{" "}
                {formatPercent(row.maximumPercentage)}
              </span>
              <span>
                {formatPercentagePoints(row.gapPercentagePoints)} ·{" "}
                {formatBRL(row.gapBRL)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
