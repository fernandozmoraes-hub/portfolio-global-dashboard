import type { Currency } from "@/domain/shared/types";

/**
 * Formatação pt-BR centralizada.
 *
 * A UI nunca monta string de moeda ou percentual à mão — sempre passa por aqui.
 * Formatos exigidos pelo briefing:
 *   R$ 1.045.000    US$ 39.410    20,3%    30/07/2026
 */

const brlWhole = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const brlCents = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: Currency, decimals: number): Intl.NumberFormat {
  const key = `${currency}:${decimals}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

/** R$ 1.045.000 (sem centavos) — padrão para valores patrimoniais. */
export function formatBRL(value: number): string {
  return brlWhole.format(value);
}

/** R$ 1.045.000,00 — quando o centavo importa. */
export function formatBRLWithCents(value: number): string {
  return brlCents.format(value);
}

/** US$ 39.410 / € 12.000 — respeita a moeda do ativo. */
export function formatCurrency(
  value: number,
  currency: Currency,
  decimals = 0,
): string {
  return formatterFor(currency, decimals).format(value);
}

/** 20,3% */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

/** +2,4 p.p. / −9,7 p.p. — usa o sinal de menos tipográfico. */
export function formatPercentagePoints(value: number, decimals = 1): string {
  const formatted = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatted} p.p.`;
}

/** 30/07/2026 */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? parseISODate(value) : value;
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** julho de 2026 */
export function formatMonthYear(value: string | Date): string {
  const date = typeof value === "string" ? parseISODate(value) : value;
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Placeholder para dado ausente.
 *
 * Usado quando uma métrica não pode ser calculada corretamente — o sistema
 * mostra "—" em vez de inventar um número.
 */
export const NO_DATA = "—";

export function formatOrDash(
  value: number | null | undefined,
  formatter: (value: number) => string,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NO_DATA;
  }
  return formatter(value);
}

function parseISODate(value: string): Date | null {
  const normalized = value.length === 10 ? `${value}T00:00:00Z` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
