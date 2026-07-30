import { Badge } from "@/components/ui/badge";
import type { AllocationStatus, PolicySeverity } from "@/domain/shared/types";

const SEVERITY_VARIANT = {
  OK: "ok",
  ATENCAO: "attention",
  VIOLACAO: "violation",
} as const;

const STATUS_LABEL: Record<AllocationStatus, string> = {
  SOBREPESO: "Sobrepeso",
  NEUTRO: "Neutro",
  SUBPESO: "Subpeso",
};

/** Verde = dentro da política · amarelo = atenção · vermelho = fora da banda. */
export function StatusBadge({
  status,
  severity,
}: {
  status: AllocationStatus;
  severity: PolicySeverity;
}) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity]}>{STATUS_LABEL[status]}</Badge>
  );
}
