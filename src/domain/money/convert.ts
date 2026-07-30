import type { Currency } from "@/domain/shared/types";
import { round2 } from "./types";

/**
 * Tabela de câmbio para uma data específica.
 * Sempre expressa taxas PARA BRL (ex.: USD -> BRL = 5.42).
 */
export type FxTable = Readonly<Partial<Record<Currency, number>>>;

export class MissingFxRateError extends Error {
  constructor(public readonly currency: Currency) {
    super(`Câmbio ausente para ${currency}. Registre a taxa antes de consolidar.`);
    this.name = "MissingFxRateError";
  }
}

/**
 * Retorna a taxa de conversão da moeda para BRL.
 * BRL sempre vale 1. Ausência de taxa é erro explícito — jamais assume 1.
 */
export function rateToBRL(currency: Currency, fx: FxTable): number {
  if (currency === "BRL") return 1;
  const rate = fx[currency];
  if (rate === undefined || rate <= 0) {
    throw new MissingFxRateError(currency);
  }
  return rate;
}

/** Converte um valor em moeda estrangeira para BRL. */
export function toBRL(amount: number, currency: Currency, fx: FxTable): number {
  return round2(amount * rateToBRL(currency, fx));
}
