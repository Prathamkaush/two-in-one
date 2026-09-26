import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { ClientService } from '../src/client-agent/client.service';
import { PrismaService } from '../src/database/prisma.service';
import { AIService } from '../src/ai/ai.service';
import { TelegramService } from '../src/telegram/telegram.service';
import { QueueService } from '../src/queues/queues.service';
import { TavilyBusinessSource } from '../src/client-agent/discovery/tavily.source';

describe('manual discovery preview', () => {
  function setup(enabled: boolean) {
    const settings = new Settings(new ConfigService({ TAVILY_ENABLED: enabled, OPENAI_ENABLED: true, TIMEZONE: 'Asia/Kolkata',
      CLIENT_REGIONS: 'Delhi', CLIENT_CATEGORIES: 'Bakeries', CLIENT_AGENT_DAILY_LEAD_LIMIT: 6 }));
    const db = { agentConfiguration: { findUnique: jest.fn().mockResolvedValue(null) },
      clientBatch: { upsert: jest.fn() }, businessLead: { create: jest.fn() } };
    const queues = { enqueue: jest.fn() }, telegram = { notify: jest.fn() };
    const discovery = { discover: jest.fn().mockResolvedValue({ businesses: [], queries: [], rejections: {}, errors: 0 }) };
    const service = new ClientService(db as unknown as PrismaService, settings, queues as unknown as QueueService,
      {} as AIService, telegram as unknown as TelegramService, discovery as unknown as TavilyBusinessSource);
    return { service, db, queues, telegram, discovery };
  }
  it('can inspect today without changing the batch, lead records or notification outbox', async () => {
    const { service, db, queues, telegram, discovery } = setup(true);
    expect(await service.previewDiscovery()).toMatchObject({ mode: 'preview', date: service.today(), businesses: [] });
    expect(discovery.discover).toHaveBeenCalledWith({ date: service.today(), regions: ['Delhi'], categories: ['Bakeries'] });
    expect(db.clientBatch.upsert).not.toHaveBeenCalled(); expect(db.businessLead.create).not.toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled(); expect(telegram.notify).not.toHaveBeenCalled();
  });
  it('requires enabled integrations before performing discovery', async () => {
    const { service, discovery } = setup(false);
    await expect(service.previewDiscovery()).rejects.toThrow('Configure Tavily and OpenAI');
    expect(discovery.discover).not.toHaveBeenCalled();
  });
});
