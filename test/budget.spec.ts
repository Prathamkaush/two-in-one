import { budgetThreshold, estimateCost, utcPeriods } from '../src/usage/budget';
describe('cost controls', () => {
  it('calculates configurable per-million prices', () => expect(estimateCost(1000, 200, { input: 1, output: 4 })).toBe(0.0018));
  it('rounds tiny nonzero usage upward', () => expect(estimateCost(1, 0, { input: 0.001, output: 1 })).toBe(0.00000001));
  it('rejects invalid token counts', () => expect(() => estimateCost(-1, 0, { input: 1, output: 1 })).toThrow());
  it.each([[0.79, 0], [0.8, 80], [0.95, 95], [1, 100], [2, 100]])('threshold %s', (spent, threshold) => expect(budgetThreshold(spent, 1)).toBe(threshold));
  it('uses explicit UTC accounting boundaries', () => expect(utcPeriods(new Date('2026-09-24T18:00:00Z')).day.toISOString()).toBe('2026-09-24T00:00:00.000Z'));
});
