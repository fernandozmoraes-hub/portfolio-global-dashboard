"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatBRL, formatPercent, NO_DATA } from "@/lib/format";

/**
 * Alocação por classe.
 *
 * Paleta monocromática deliberada: variações de um mesmo azul-petróleo, do mais
 * escuro (maior posição) ao mais claro. Um gráfico financeiro com sete cores
 * saturadas parece painel de trading — e a cor passaria a competir com o
 * semáforo de política, que é onde cor realmente significa algo aqui.
 */

const PALETTE = [
  "oklch(0.38 0.055 225)",
  "oklch(0.46 0.058 222)",
  "oklch(0.54 0.058 220)",
  "oklch(0.62 0.055 218)",
  "oklch(0.70 0.048 216)",
  "oklch(0.78 0.038 214)",
  "oklch(0.86 0.026 212)",
];

export interface DonutSlice {
  readonly label: string;
  readonly valueBRL: number;
  readonly percentage: number;
}

export function AllocationDonut({ data }: { data: readonly DonutSlice[] }) {
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data as DonutSlice[]}
              dataKey="valueBRL"
              nameKey="label"
              innerRadius="58%"
              outerRadius="92%"
              paddingAngle={1}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {data.map((slice, index) => (
                <Cell
                  key={slice.label}
                  fill={PALETTE[index % PALETTE.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                fontSize: 12,
              }}
              formatter={(value) =>
                typeof value === "number" ? formatBRL(value) : NO_DATA
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex w-full flex-col gap-2">
        {data.map((slice, index) => (
          <li key={slice.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
            />
            <span className="flex-1 truncate">{slice.label}</span>
            <span className="tabular text-[var(--muted-foreground)]">
              {formatPercent(slice.percentage)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
