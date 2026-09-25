import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Settings } from '../common/config/settings.service';
import { PrismaService } from '../database/prisma.service';
import { QueueService } from '../queues/queues.service';
import { redact } from '../common/logging/safe-logger';
import { Agent } from '@prisma/client';

@Injectable()
export class TelegramService {
  constructor(private readonly settings: Settings, private readonly db: PrismaService, private readonly queues: QueueService) {}
  splitBots() { return Boolean(this.settings.get('CLIENT_TELEGRAM_BOT_TOKEN') || this.settings.get('RESEARCH_TELEGRAM_BOT_TOKEN')); }
  destination(agent: Agent) {
    const target = agent === 'SYSTEM' ? 'CLIENT' : agent;
    return this.splitBots() ? {
      token: this.settings.get(`${target}_TELEGRAM_BOT_TOKEN`),
      chatId: this.settings.get(`${target}_TELEGRAM_CHAT_ID`) || this.settings.get('TELEGRAM_CHAT_ID'),
      secret: this.settings.get(`${target}_TELEGRAM_WEBHOOK_SECRET`),
    } : { token: this.settings.get('TELEGRAM_BOT_TOKEN'), chatId: this.settings.get('TELEGRAM_CHAT_ID'), secret: this.settings.get('TELEGRAM_WEBHOOK_SECRET') };
  }
  async notify(key: string, message: string, agent: Agent = 'SYSTEM'): Promise<string> {
    if (agent === 'SYSTEM' && this.splitBots()) {
      const ids = await Promise.all([this.notify(`${key}-CLIENT`, message, 'CLIENT'), this.notify(`${key}-RESEARCH`, message, 'RESEARCH')]);
      return ids[0];
    }
    // Outbox persists even when notifications are disabled or Redis is down.
    const row = await this.db.notification.upsert({ where: { key }, update: {},
      create: { key, agent, text: redact(message).slice(0, 3500) } });
    if (this.settings.get('TELEGRAM_ENABLED') && !row.sentAt) {
      await this.queues.enqueue('telegram', 'send', row.id, { notificationId: row.id });
    }
    return row.id;
  }
  async deliver(notificationId: string) {
    if (!this.settings.get('TELEGRAM_ENABLED')) throw new ServiceUnavailableException('Telegram is disabled');
    const notification = await this.db.notification.findUniqueOrThrow({ where: { id: notificationId } });
    if (notification.sentAt) return;
    const destination = this.destination(notification.agent ?? 'SYSTEM');
    if (!destination.token || !destination.chatId) throw new ServiceUnavailableException('Telegram destination is not configured');
    // Only the configured operator can receive messages. No destination from job payloads.
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${destination.token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.settings.get('HTTP_TIMEOUT_MS')),
        body: JSON.stringify({ chat_id: destination.chatId, text: notification.text,
          link_preview_options: { is_disabled: true } }),
      });
    } catch { throw new Error('Telegram transport failed'); }
    if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) throw new Error('Telegram rejected notification');
    await this.db.notification.update({ where: { id: notificationId }, data: { sentAt: new Date() } });
  }
}
