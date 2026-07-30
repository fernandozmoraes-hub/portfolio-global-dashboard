import { formatBRL, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Quebra por dimensão (país, moeda, setor, risk bucket, fator).
 *
 * Server Component puro: nenhuma linha de JavaScript vai para o browser.
 * Um gráfico de barras aqui seria JS desnecessário — a barra é uma div.
 */

export interface BreakdownItem {
  readonly key: string;
  readonly label?: string;
  readonly valueBRL: number;
  readonly weight: number;
  readonly hint?: string;
}

export function BreakdownBars({
  items,
  emptyMessage = "Sem dados para exibir.",
  className,
}: {
  items: readonly BreakdownItem[];
  emptyMessage?: string;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">{emptyMessage}</p>
    );
  }

  const max = Math.max(...items.map((item) => item.weight), 1);

  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate" title={item.hint ?? item.label ?? item.key}>
              {item.label ?? item.key}
            </span>
            <span className="tabular shrink-0 text-[var(--muted-foreground)]">
              {formatBRL(item.valueBRL)}
              <span className="ml-2 font-medium text-[var(--foreground)]">
                {formatPercent(item.weight)}
              </span>
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]"
            role="presentation"
          >
            <div
              className="h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${(item.weight / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
