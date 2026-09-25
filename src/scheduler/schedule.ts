export interface ScheduleSettings { timezone: string; clientTime: string; start: string; end: string; intervalMinutes: number }
export function localClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
export function scheduledOperations(now: Date, settings: ScheduleSettings) {
  const local = localClock(now, settings.timezone);
  const minute = minutes(local.time), start = minutes(settings.start), end = minutes(settings.end);
  return { ...local, client: local.time === settings.clientTime,
    researchBatch: minute >= start && minute < end && (minute - start) % settings.intervalMinutes === 0,
    researchSummary: minute === end };
}
