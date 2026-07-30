/**
 * Tipos monetários com marcação (branded types).
 *
 * MOTIVAÇÃO
 * ---------
 * O briefing exige que as projeções de aposentadoria trabalhem em REAIS REAIS
 * (poder de compra de hoje). O erro mais provável e mais caro deste sistema é
 * somar um valor nominal com um valor real sem perceber.
 *
 * `RealBRL` e `NominalBRL` são ambos `number` em tempo de execução — custo zero.
 * Em tempo de compilação, o TypeScript recusa misturá-los.
 *
 *   const a = realBRL(1000);
 *   const b = nominalBRL(1000);
 *   a + b;            // ❌ erro de tipo
 *   addReal(a, a);    // ✅
 */

declare const brand: unique symbol;

type Brand<T, B> = T & { readonly [brand]: B };

/** Valor em reais de HOJE (poder de compra atual). Usado em toda projeção. */
export type RealBRL = Brand<number, "RealBRL">;

/** Valor em reais correntes/futuros (contém inflação embutida). */
export type NominalBRL = Brand<number, "NominalBRL">;

export function realBRL(value: number): RealBRL {
  return value as RealBRL;
}

export function nominalBRL(value: number): NominalBRL {
  return value as NominalBRL;
}

/** Remove a marcação. Use apenas na fronteira de formatação/persistência. */
export function unwrap(value: RealBRL | NominalBRL): number {
  return value as number;
}

export function addReal(...values: RealBRL[]): RealBRL {
  return realBRL(values.reduce<number>((acc, v) => acc + (v as number), 0));
}

export function subtractReal(a: RealBRL, b: RealBRL): RealBRL {
  return realBRL((a as number) - (b as number));
}

export function scaleReal(value: RealBRL, factor: number): RealBRL {
  return realBRL((value as number) * factor);
}

/**
 * Converte um valor nominal futuro para reais de hoje.
 *
 * @param value           valor nominal
 * @param annualInflation inflação anual (0.045 = 4,5% a.a.)
 * @param years           anos à frente
 */
export function deflate(
  value: NominalBRL,
  annualInflation: number,
  years: number,
): RealBRL {
  return realBRL((value as number) / Math.pow(1 + annualInflation, years));
}

/**
 * Converte um valor real de hoje para nominal em N anos.
 * Útil apenas para exibir "quanto isso será em reais correntes" — nunca
 * para alimentar cálculos de projeção.
 */
export function inflate(
  value: RealBRL,
  annualInflation: number,
  years: number,
): NominalBRL {
  return nominalBRL((value as number) * Math.pow(1 + annualInflation, years));
}

/**
 * Arredonda para 2 casas com correção de erro binário.
 *
 * DECISÃO: o domínio opera com `number` (double IEEE-754). Para patrimônio na
 * casa dos milhões com 2 decimais, a precisão de ~15-16 dígitos significativos
 * é folgada, e as projeções usam fórmula fechada (sem acúmulo iterativo).
 * O banco guarda `numeric`, então a persistência não perde precisão.
 * Regra: nunca comparar dinheiro por igualdade sem passar por `round2`.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * Arredonda para 6 casas — precisão usada em TAXAS, não em dinheiro.
 * Espelha `numeric(8,6)` de retirement_plan.expected_real_return.
 */
export function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
