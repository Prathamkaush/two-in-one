import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { PrismaService } from '../src/database/prisma.service';
import { ResearchService } from '../src/research-agent/research.service';
import { QueueService } from '../src/queues/queues.service';
import { AIService } from '../src/ai/ai.service';
import { TelegramService } from '../src/telegram/telegram.service';
import { UsageService } from '../src/usage/usage.service';
import { AgentsScheduler } from '../src/scheduler/agents.scheduler';
import { ClientService } from '../src/client-agent/client.service';
import { sendResearchReport } from '../src/telegram/research-report';

it.each(['ACTIVE', 'ANALYZING'])('does not issue collection summaries after the %s cycle ends', async (status) => {
  const db = { researchCycle: { findFirst: jest.fn().mockResolvedValue({ id: 'cycle', status, endDate: new Date(0) }) },
    researchItem: { findMany: jest.fn() }, dailyReport: { upsert: jest.fn() } };
  const telegram = { notify: jest.fn() };
  const service = new ResearchService(db as unknown as PrismaService, {} as Settings, {} as QueueService, {} as AIService,
    telegram as unknown as TelegramService, {} as UsageService);
  await service.dailySummary(); await service.dailySummary();
  expect(db.researchItem.findMany).not.toHaveBeenCalled();
  expect(db.dailyReport.upsert).not.toHaveBeenCalled();
  expect(telegram.notify.mock.calls.map(([key]) => key)).toEqual(['research-closed-cycle', 'research-closed-cycle']);
  expect(telegram.notify.mock.calls[0][1]).toContain('Final analysis is pending');
});

it('checks all ended cycles despite blocked finalization and unavailable collection', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-30T07:30:00Z'));
  try {
    const settings = new Settings(new ConfigService({ TIMEZONE: 'Asia/Kolkata', CLIENT_AGENT_TIME: '09:00', RESEARCH_START_TIME: '13:00',
      RESEARCH_END_TIME: '17:00', RESEARCH_BATCH_INTERVAL_MINUTES: 30, RESEARCH_AGENT_ENABLED: true }));
    const research = { finalize: jest.fn().mockRejectedValueOnce(new Error('Pending items')).mockResolvedValue({}), collectNow: jest.fn().mockRejectedValue(new Error('closed')) };
    const db = { researchCycle: { findMany: jest.fn().mockResolvedValue([{ id: 'first' }, { id: 'second' }]) } };
    await new AgentsScheduler(settings, {} as ClientService, research as unknown as ResearchService, db as unknown as PrismaService).tick();
    expect(research.finalize.mock.calls).toEqual([['first'], ['second']]);
    expect(research.collectNow).toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('sends saved opportunity cards with source links and stable delivery keys', async () => {
  const db = { monthlyReport: { findUnique: jest.fn().mockResolvedValue({ id: 'report', insufficiencyReason: 'One supported hypothesis', opportunities: [
    { id: 'op', rank: 1, name: 'Scheduling', problem: 'Manual work', targetCustomer: 'Shops', mvp: 'Booking tool', businessModel: 'Subscription', confidence: 0.5,
      sourceReferences: ['item'], validationExperiments: ['Interview owners'] },
  ] }) }, researchItem: { findMany: jest.fn().mockResolvedValue([{ sourceUrl: 'https://example.com/evidence' }]) } };
  const telegram = { notify: jest.fn() };
  expect(await sendResearchReport(db as unknown as PrismaService, telegram as unknown as TelegramService, 'cycle', 'delivery')).toBe(true);
  expect(telegram.notify.mock.calls[1]).toEqual(['delivery-op', expect.stringContaining('https://example.com/evidence'), 'RESEARCH']);
  expect(telegram.notify.mock.calls[1][1]).toContain('Proposed MVP: Booking tool');
  db.monthlyReport.findUnique.mockResolvedValue(null);
  expect(await sendResearchReport(db as unknown as PrismaService, telegram as unknown as TelegramService, 'cycle', 'missing')).toBe(false);
  expect(telegram.notify).toHaveBeenCalledTimes(2);
});
