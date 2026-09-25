import { BadRequestException, Body, Controller, Get, Param, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AdminGuard } from '../common/security/admin.guard';
import { Settings } from '../common/config/settings.service';
import { PrismaService } from '../database/prisma.service';
import { UsageService } from '../usage/usage.service';
import { TelegramService } from '../telegram/telegram.service';
import { QueueService } from '../queues/queues.service';
import { QUEUES } from '../queues/queues.module';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly db: PrismaService, private readonly usage: UsageService,
    private readonly telegram: TelegramService, private readonly settings: Settings, private readonly queues: QueueService) {}
  @Get('status') async status() {
    return { phase: 'core-mvp', agents: { client: 'verified-intake-mvp', research: 'rss-and-verified-intake-mvp' },
      integrations: { openai: this.settings.get('OPENAI_ENABLED'), telegram: this.settings.get('TELEGRAM_ENABLED') },
      latestRuns: await this.db.automationRun.findMany({ take: 10, orderBy: { startedAt: 'desc' } }) };
  }
  @Get('cost') cost() { return this.usage.summary(); }
  @Get('queues') async queueStatus() {
    return Object.fromEntries(await Promise.all(QUEUES.map(async (name) => [name,
      await this.queues.get(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')])));
  }
  @Post('telegram/test') async telegramTest(@Body() body: unknown) {
    if (!this.settings.get('TELEGRAM_ENABLED')) throw new ServiceUnavailableException('Telegram is disabled');
    const parsed = z.object({ agent: z.enum(['CLIENT', 'RESEARCH', 'SYSTEM']).default('SYSTEM') }).strict().safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Expected agent CLIENT, RESEARCH, or SYSTEM');
    return { notificationId: await this.telegram.notify(`manual-test-${randomUUID()}`, 'Dual Automation Platform: Telegram test succeeded.', parsed.data.agent) };
  }
  @Post('queues/:queue/jobs/:id/retry') async retry(@Param('queue') queue: string, @Param('id') id: string) {
    const name = QUEUES.find((v) => v === queue); if (!name) throw new BadRequestException('Unknown queue');
    const job = await this.queues.get(name).getJob(id);
    if (!job || await job.getState() !== 'failed') throw new BadRequestException('A failed job is required');
    await job.retry(); return { jobId: job.id };
  }
}
