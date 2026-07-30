import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge de status. As variantes de cor mapeiam PolicySeverity:
 * ok = dentro da política, attention = atenção, violation = fora da banda.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral:
          "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
        ok: "border-transparent bg-[var(--status-ok)]/12 text-[var(--status-ok)]",
        attention:
          "border-transparent bg-[var(--status-attention)]/14 text-[var(--status-attention)]",
        violation:
          "border-transparent bg-[var(--status-violation)]/12 text-[var(--status-violation)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
