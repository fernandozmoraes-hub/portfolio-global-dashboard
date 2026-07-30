"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBRL, formatMonthYear, NO_DATA } from "@/lib/format";

/**
 * Evolução patrimonial: patrimônio contra aportes acumulados.
 *
 * A distância entre as duas linhas é o ganho de mercado. É a leitura que
 * separa "meu patrimônio cresceu" de "eu depositei dinheiro".
 */

export interface EvolutionChartPoint {
  readonly referenceDate: string;
  readonly portfolio: number;
  readonly cumulativeContributions: number;
}

export function EvolutionChart({
  data,
}: {
  data: readonly EvolutionChartPoint[];
}) {
  const points = data.map((point) => ({
    ...point,
    label: formatMonthYear(point.referenceDate),
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="fillPortfolio" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="2 4"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={78}
            tickFormatter={(value: number) =>
              `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`
            }
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--muted-foreground)" }}
            formatter={(value, name) => [
              typeof value === "number" ? formatBRL(value) : NO_DATA,
              name === "portfolio" ? "Patrimônio" : "Aportes acumulados",
            ]}
          />
          <Area
            type="monotone"
            dataKey="portfolio"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#fillPortfolio)"
          />
          <Line
            type="monotone"
            dataKey="cumulativeContributions"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
