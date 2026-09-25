import { ConfigService } from '@nestjs/config';
import { Agent } from '@prisma/client';
import { Settings } from '../src/common/config/settings.service';
import { TelegramService } from '../src/telegram/telegram.service';
import { TelegramController } from '../src/telegram/telegram.controller';
import { PrismaService } from '../src/database/prisma.service';
import { QueueService } from '../src/queues/queues.service';

describe('separate Telegram bots', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  function setup(agent: Agent = 'CLIENT') {
    const settings = new Settings(new ConfigService({ TELEGRAM_ENABLED: true, CLIENT_TELEGRAM_BOT_TOKEN: '1:client', RESEARCH_TELEGRAM_BOT_TOKEN: '2:research',
      CLIENT_TELEGRAM_CHAT_ID: '42', RESEARCH_TELEGRAM_CHAT_ID: '43', CLIENT_TELEGRAM_WEBHOOK_SECRET: 'c'.repeat(32), RESEARCH_TELEGRAM_WEBHOOK_SECRET: 'r'.repeat(32), TIMEZONE: 'UTC', HTTP_TIMEOUT_MS: 1000 }));
    const db = { notification: { findUniqueOrThrow: jest.fn().mockResolvedValue({ agent, text: 'test', sentAt: null }), update: jest.fn(),
      upsert: jest.fn().mockImplementation(async ({ create }: { create: { key: string } }) => ({ ...create, id: create.key, sentAt: null })) } };
    const queues = { enqueue: jest.fn() };
    const service = new TelegramService(settings, db as unknown as PrismaService, queues as unknown as QueueService);
    return { settings, db, service, controller: new TelegramController(settings, db as unknown as PrismaService, service) };
  }
  it.each([['CLIENT', '1:client', '42'], ['RESEARCH', '2:research', '43']] as const)('delivers %s using its own token and chat', async (agent, token, chat) => {
    const mock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); global.fetch = mock;
    await setup(agent).service.deliver('n');
    expect(mock.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(JSON.parse(mock.mock.calls[0][1].body).chat_id).toBe(chat);
  });
  it('stores routing in the outbox and broadcasts system notices to both bots', async () => {
    const { service, db } = setup();
    await service.notify('budget', 'warning');
    expect(db.notification.upsert.mock.calls.map(([arg]) => arg.create.agent)).toEqual(['CLIENT', 'RESEARCH']);
    expect(db.notification.upsert.mock.calls.map(([arg]) => arg.create.key)).toEqual(['budget-CLIENT', 'budget-RESEARCH']);
  });
  it('isolates update IDs and sends replies through the receiving bot', async () => {
    const { controller, service } = setup();
    const notify = jest.spyOn(service, 'notify').mockResolvedValue('id');
    await controller.agentWebhook('client', 'c'.repeat(32), { update_id: 1, message: { text: '/status', chat: { id: 42 } } });
    await controller.agentWebhook('research', 'r'.repeat(32), { update_id: 1, message: { text: '/status', chat: { id: 43 } } });
    expect(notify.mock.calls.map(([key, , bot]) => [key, bot])).toEqual([['command-CLIENT-1', 'CLIENT'], ['command-RESEARCH-1', 'RESEARCH']]);
  });
  it('rejects the other bot secret and ignores unauthorized chats', async () => {
    const { controller, service } = setup(); const notify = jest.spyOn(service, 'notify');
    await expect(controller.agentWebhook('research', 'c'.repeat(32), {})).rejects.toThrow();
    await expect(controller.webhook('c'.repeat(32), {})).rejects.toThrow();
    await controller.agentWebhook('client', 'c'.repeat(32), { update_id: 1, message: { text: '/status', chat: { id: 43 } } });
    expect(notify).not.toHaveBeenCalled();
  });
});
