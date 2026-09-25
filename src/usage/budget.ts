export interface ModelPrice { input: number; output: number }
export function estimateCost(inputTokens: number, outputTokens: number, price: ModelPrice): number {
  if (![inputTokens, outputTokens].every((n) => Number.isInteger(n) && n >= 0)) throw new Error('Invalid token usage');
  return Math.ceil(((inputTokens * price.input + outputTokens * price.output) / 1_000_000) * 1e8) / 1e8;
}
export function budgetThreshold(spent: number, limit: number): 0 | 80 | 95 | 100 {
  const ratio = spent / limit;
  return ratio >= 1 ? 100 : ratio >= 0.95 ? 95 : ratio >= 0.8 ? 80 : 0;
}
export function utcPeriods(now: Date) {
  return { day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
}
