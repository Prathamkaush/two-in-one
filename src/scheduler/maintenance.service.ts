import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { QueueService, jobKey } from '../queues/queues.service';
import { Settings } from '../common/config/settings.service';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private running = false;
  constructor(private readonly db: PrismaService, private readonly queues: QueueService, private readonly settings: Settings) {}
  @Cron('*/1 * * * *')
  async flushOutbox() {
    if (this.running || !this.settings.get('TELEGRAM_ENABLED')) return;
    this.running = true;
    try {
      const rows = await this.db.notification.findMany({ where: { sentAt: null }, take: 100, orderBy: { createdAt: 'asc' } });
      for (const row of rows) {
        const existing = await this.queues.get('telegram').getJob(jobKey('telegram', 'send', row.id));
        // Exhausted jobs require operator attention, never an infinite auto-retry loop.
        if (!existing) await this.queues.enqueue('telegram', 'send', row.id, { notificationId: row.id });
      }
    } catch { this.logger.error('Notification outbox flush failed'); }
    finally { this.running = false; }
  }
}
