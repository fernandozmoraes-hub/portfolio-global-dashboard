import Link from "next/link";
import type { AssetExposure } from "@/domain/consolidation/consolidate";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatPercent } from "@/lib/format";

/**
 * Maiores exposições econômicas CONSOLIDADAS.
 *
 * A coluna de custódias é o ponto: "2 corretoras" mostra que aquela linha soma
 * posições de lugares diferentes. Corretora é onde o papel está guardado;
 * exposição é o quanto do patrimônio depende daquele emissor.
 */
export function TopExposures({
  exposures,
  totalBRL,
}: {
  exposures: readonly AssetExposure[];
  totalBRL: number;
}) {
  if (exposures.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Nenhuma posição importada.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--border)]">
      {exposures.map((exposure) => {
        const weight = totalBRL === 0 ? 0 : (exposure.valueBRL / totalBRL) * 100;
        return (
          <li key={exposure.assetId} className="py-2.5 first:pt-0 last:pb-0">
            <Link
              href={`/carteira/${exposure.assetId}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sm outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-medium">{exposure.ticker}</span>
                <span className="truncate text-sm text-[var(--muted-foreground)]">
                  {exposure.assetName}
                </span>
                {exposure.custodyCount > 1 ? (
                  <Badge variant="neutral">
                    {exposure.custodyCount} corretoras
                  </Badge>
                ) : null}
              </div>
              <span className="tabular shrink-0 text-sm">
                {formatBRL(exposure.valueBRL)}
                <span className="ml-3 font-medium">{formatPercent(weight, 2)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
