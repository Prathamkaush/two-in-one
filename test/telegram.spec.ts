import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { PrismaService } from '../src/database/prisma.service';
import { QueueService } from '../src/queues/queues.service';
import { TelegramService } from '../src/telegram/telegram.service';
describe('Telegram transport', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = fetchMock; });
  afterEach(() => { global.fetch = originalFetch; });
  function setup(sentAt: Date | null = null, enabled = true) {
    const db = { notification: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'n', text: '<raw>', sentAt }), update: jest.fn(), upsert: jest.fn().mockResolvedValue({ id: 'n', sentAt }) } };
    const queues = { enqueue: jest.fn() };
    const settings = new Settings(new ConfigService({ TELEGRAM_ENABLED: enabled, TELEGRAM_BOT_TOKEN: '123:secret', TELEGRAM_CHAT_ID: '42', HTTP_TIMEOUT_MS: 1000 }));
    return { db, queues, service: new TelegramService(settings, db as unknown as PrismaService, queues as unknown as QueueService) };
  }
  it('sends plain text only to configured operator', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { service, db } = setup();
    await service.deliver('n');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ chat_id: '42', text: '<raw>' });
    expect(body.parse_mode).toBeUndefined();
    expect(db.notification.update).toHaveBeenCalled();
  });
  it('does not resend a delivered message', async () => { await setup(new Date()).service.deliver('n'); expect(fetchMock).not.toHaveBeenCalled(); });
  it('does not mark a rejected response delivered', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    const { service, db } = setup();
    await expect(service.deliver('n')).rejects.toThrow('429');
    expect(db.notification.update).not.toHaveBeenCalled();
  });
  it('does not expose a token in network errors', async () => {
    fetchMock.mockRejectedValue(new Error('https://api.telegram.org/bot123:secret/sendMessage'));
    await expect(setup().service.deliver('n')).rejects.toThrow('Telegram transport failed');
  });
  it('retains outbox messages when disabled', async () => {
    const { service, db, queues } = setup(null, false);
    await service.notify('key', 'message');
    expect(db.notification.upsert).toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled();
  });
});
