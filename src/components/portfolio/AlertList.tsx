import type { RiskAlert } from "@/domain/risk/limits";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatPercent, formatPercentagePoints } from "@/lib/format";

const SCOPE_LABEL: Record<RiskAlert["scope"], string> = {
  SINGLE_ASSET: "Ativo",
  RISK_BUCKET: "Bucket",
  SECTOR: "Setor",
  COUNTRY: "País",
  CURRENCY: "Moeda",
};

/**
 * Alertas de limite.
 *
 * Todos calculados sobre a EXPOSIÇÃO CONSOLIDADA: um ativo a 3% em duas
 * corretoras aparece aqui como 6%, que é a leitura que importa.
 */
export function AlertList({ alerts }: { alerts: readonly RiskAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Nenhum limite de risco ultrapassado ou em zona de atenção.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--border)]">
      {alerts.map((alert) => (
        <li
          key={`${alert.scope}-${alert.scopeKey}-${alert.subject}`}
          className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant={alert.severity === "VIOLACAO" ? "violation" : "attention"}
            >
              {alert.severity === "VIOLACAO" ? "Fora do limite" : "Atenção"}
            </Badge>
            <span className="truncate text-sm">
              <span className="text-[var(--muted-foreground)]">
                {SCOPE_LABEL[alert.scope]}
              </span>{" "}
              <strong className="font-medium">{alert.subject}</strong>
            </span>
          </div>
          <span className="tabular shrink-0 text-xs text-[var(--muted-foreground)]">
            {formatPercent(alert.currentPercentage, 2)} de{" "}
            {formatPercent(alert.maxPercentage, 2)} ·{" "}
            {formatPercentagePoints(alert.excessPercentagePoints, 2)}
            {alert.excessBRL > 0 ? ` · ${formatBRL(alert.excessBRL)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
