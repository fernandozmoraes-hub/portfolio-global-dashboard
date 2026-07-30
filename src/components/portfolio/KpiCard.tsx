import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NO_DATA } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Card de indicador.
 *
 * `value` recebe null quando a métrica não pode ser calculada corretamente —
 * o card exibe "—" e a explicação, em vez de um número inventado.
 */
export function KpiCard({
  title,
  value,
  hint,
  tone = "neutral",
}: {
  title: string;
  value: string | null;
  hint?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <Card>
      <CardHeader className="p-5 pb-2">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <p
          className={cn(
            "tabular text-2xl font-semibold tracking-tight",
            value === null && "text-[var(--muted-foreground)]",
            tone === "positive" && "text-[var(--status-ok)]",
            tone === "negative" && "text-[var(--status-violation)]",
          )}
        >
          {value ?? NO_DATA}
        </p>
        {hint ? (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
