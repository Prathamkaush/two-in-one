import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Settings } from '../common/config/settings.service';
import { ClientService } from '../client-agent/client.service';
import { scheduledOperations } from './schedule';
import { ResearchService } from '../research-agent/research.service';
import { PrismaService } from '../database/prisma.service';
@Injectable()
export class AgentsScheduler {
  private readonly logger = new Logger(AgentsScheduler.name);
  constructor(private readonly settings: Settings, private readonly client: ClientService, private readonly research: ResearchService, private readonly db: PrismaService) {}
  @Cron('* * * * *')
  async tick() {
    const due = scheduledOperations(new Date(), { timezone: this.settings.get('TIMEZONE'), clientTime: this.settings.get('CLIENT_AGENT_TIME'),
      start: this.settings.get('RESEARCH_START_TIME'), end: this.settings.get('RESEARCH_END_TIME'), intervalMinutes: this.settings.get('RESEARCH_BATCH_INTERVAL_MINUTES') });
    if (this.settings.get('CLIENT_AGENT_ENABLED') && due.client) {
      try { await this.client.trigger(); } catch { this.logger.error('Client schedule enqueue failed'); }
    }
    if (this.settings.get('RESEARCH_AGENT_ENABLED')) {
      try {
        if (due.researchBatch) await this.research.collectNow();
        if (due.researchSummary) await this.research.dailySummary();
        const ended = await this.db.researchCycle.findMany({ where: { status: { in: ['ACTIVE', 'ANALYZING'] }, endDate: { lte: new Date() } } });
        for (const cycle of ended) await this.research.finalize(cycle.id);
      } catch { this.logger.warn('Research scheduling is waiting for an active cycle, pending processing, or available infrastructure'); }
    }
  }
}
