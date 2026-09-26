import { formatDailyReport } from '../src/telegram/report-format';

it('keeps diagnostics out of the client message and distinguishes unknown from absent', () => {
  const text = formatDailyReport('CLIENT', '2026-09-26', { selectedCount: 0, reviewCount: 1, candidateCount: 1,
    discovery: { extractedCandidates: 6, uncertainWebsites: 1, enrichmentFailures: 1, queries: ['private diagnostic'], refreshHistory: { previous: true } } });
  expect(text).toContain('Qualified leads: 0');
  expect(text).toContain('Needs your review: 1');
  expect(text).toContain('Unknown website does not mean no website');
  expect(text).not.toContain('private diagnostic');
  expect(text).not.toContain('refreshHistory');
  expect(text.length).toBeLessThan(2000);
});

it('handles older reports and renders research counts without JSON', () => {
  expect(formatDailyReport('CLIENT', 'today', null)).toContain('Qualified leads: 0');
  const text = formatDailyReport('RESEARCH', 'today', { processed: 16, pending: 0, sources: { TechCrunch: 11 } });
  expect(text).toContain('Processed: 16');
  expect(text).toContain('TechCrunch: 11');
  expect(text).not.toContain('{');
});
