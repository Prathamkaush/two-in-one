import { scheduledOperations } from '../src/scheduler/schedule';
const settings = { timezone: 'Asia/Kolkata', clientTime: '09:00', start: '13:00', end: '17:00', intervalMinutes: 30 };
describe('schedule boundaries', () => {
  it.each([
    ['2026-09-24T07:29:00Z', false, false], ['2026-09-24T07:30:00Z', true, false],
    ['2026-09-24T08:00:00Z', true, false], ['2026-09-24T08:01:00Z', false, false],
    ['2026-09-24T11:00:00Z', true, false], ['2026-09-24T11:30:00Z', false, true],
  ])('%s', (instant, batch, summary) => {
    expect(scheduledOperations(new Date(instant), settings)).toMatchObject({ date: '2026-09-24', researchBatch: batch, researchSummary: summary });
  });
  it('uses the configured local date across midnight', () => {
    expect(scheduledOperations(new Date('2026-09-24T20:00:00Z'), settings).date).toBe('2026-09-25');
  });
  it('handles DST using IANA timezone data', () => {
    expect(scheduledOperations(new Date('2026-03-08T17:00:00Z'), { ...settings, timezone: 'America/New_York' }).researchBatch).toBe(true);
  });
});
