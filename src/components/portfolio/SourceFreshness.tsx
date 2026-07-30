import type { SourceFreshness } from "@/domain/positions/current";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatDate } from "@/lib/format";

/**
 * Data e defasagem de cada fonte.
 *
 * Corretoras fecham e exportam em dias diferentes, então a carteira corrente é
 * montada com a última data DE CADA CONTA. Esconder isso daria a impressão
 * falsa de uma foto tirada num instante único — por isso a defasagem é
 * exibida, não suprimida.
 */
export function SourceFreshnessPanel({
  sources,
  hasMixedDates,
}: {
  sources: readonly SourceFreshness[];
  hasMixedDates: boolean;
}) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Nenhuma fonte de posição registrada.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {sources.map((source) => (
          <li
            key={source.accountId}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{source.brokerName}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                {source.accountName} · {source.positionCount}{" "}
                {source.positionCount === 1 ? "posição" : "posições"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular text-sm text-[var(--muted-foreground)]">
                {formatBRL(source.valueBRL)}
              </span>
              <Badge variant={source.isStale ? "attention" : "neutral"}>
                {formatDate(source.referenceDate)}
                {source.ageDays > 0 ? ` · ${source.ageDays}d` : ""}
              </Badge>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-[var(--muted-foreground)]">
        {hasMixedDates
          ? "As fontes estão em datas diferentes. A carteira corrente usa a última posição de cada conta — o NAV de fechamento, por sua vez, reprecifica tudo para uma única data e um único câmbio."
          : "Todas as fontes estão na mesma data de referência."}
      </p>
    </div>
  );
}
