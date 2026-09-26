import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { Agent } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Settings } from '../common/config/settings.service';
import { PrismaService } from '../database/prisma.service';
import { TelegramService } from './telegram.service';
import { localClock } from '../scheduler/schedule';
import { formatDailyReport } from './report-format';
const updateSchema = z.object({ update_id: z.number().int(), message: z.object({ text: z.string().max(1000), chat: z.object({ id: z.number().int() }) }).optional() });
@Controller('telegram')
export class TelegramController {
  constructor(private readonly settings: Settings, private readonly db: PrismaService, private readonly telegram: TelegramService) {}
  @Post('webhook') async webhook(@Headers('x-telegram-bot-api-secret-token') token: string | undefined, @Body() body: unknown) {
    if (this.telegram.splitBots()) throw new UnauthorizedException();
    return this.handle('SYSTEM', token, body);
  }
  @Post('webhook/:agent') async agentWebhook(@Param('agent') agent: string, @Headers('x-telegram-bot-api-secret-token') token: string | undefined, @Body() body: unknown) {
    if (!this.telegram.splitBots() || !['client', 'research'].includes(agent)) throw new UnauthorizedException();
    return this.handle(agent === 'client' ? 'CLIENT' : 'RESEARCH', token, body);
  }
  private async handle(bot: Agent, token: string | undefined, body: unknown) {
    const { secret, chatId } = this.telegram.destination(bot);
    const a = Buffer.from(token ?? ''), b = Buffer.from(secret);
    if (!this.settings.get('TELEGRAM_ENABLED') || !secret || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success || !parsed.data.message) return { ok: true };
    const { message, update_id } = parsed.data;
    if (String(message.chat.id) !== chatId) return { ok: true };
    const command = message.text.split(/\s|@/)[0];
    const date = localClock(new Date(), this.settings.get('TIMEZONE')).date;
    let response: string;
    if (command === '/client_reviews') {
      const pageText = message.text.trim().split(/\s+/)[1] ?? '1';
      if (!/^[1-9]\d{0,3}$/.test(pageText)) {
        response = 'Use /client_reviews or /client_reviews 2 for the next page.';
      } else {
        const page = Number(pageText);
        const leads = await this.db.businessLead.findMany({
          where: { status: 'REVIEW_PRESENTED' }, orderBy: [{ presentedAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * 6, take: 7,
          include: { sources: { take: 1 }, drafts: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        for (const lead of leads.slice(0, 6)) {
          const evidence = lead.sources[0]?.evidence;
          const facts = evidence && typeof evidence === 'object' && !Array.isArray(evidence) && Array.isArray(evidence.facts) ? evidence.facts : [];
          const observed = facts.slice(0, 2).map((fact) => fact && typeof fact === 'object' && !Array.isArray(fact) && typeof fact.claim === 'string' ? fact.claim.slice(0, 180) : '').filter(Boolean).join('\n');
          const social = Array.isArray(lead.socialUrls) ? lead.socialUrls.find((url) => typeof url === 'string') : null;
          const card = ['CLIENT REVIEW - NOT QUALIFIED', lead.businessName.slice(0, 120),
            `${lead.category} | ${lead.location}`, `Profile: ${lead.instagramUrl ?? social ?? 'Not recorded'}`,
            `Website: ${lead.websiteUrl ?? 'UNKNOWN - not confirmed absent'}`,
            'Check manually: bio links, dedicated website, recent posts and business activity.',
            observed ? `Observed evidence:\n${observed}` : 'No quoted evidence recorded.',
            `Draft (only after verification):\n${lead.drafts[0]?.content.slice(0, 500) ?? 'No draft saved.'}`,
            `Lead ID: ${lead.id}`, 'No outreach sent.'].join('\n\n');
          await this.telegram.notify(`command-${bot}-${update_id}-review-${lead.id}`, card, bot);
        }
        response = leads.length ? `Review cards: page ${page}. Rejected and contacted leads are excluded.${leads.length > 6 ? `\nNext: /client_reviews ${page + 1}` : '\nNo more pending review cards.'}` :
          'No pending review cards on this page. Rejected and contacted leads are excluded. /client_today shows historical counts from the daily run.';
      }
    } else if (['/client', '/client_today', '/research_today'].includes(command)) {
      const agent = command === '/research_today' ? 'RESEARCH' : 'CLIENT';
      const report = await this.db.dailyReport.findUnique({ where: { agent_date: { agent, date } } });
      response = report ? formatDailyReport(agent, date, report.content) : `${agent}: no report for ${date}.`;
    } else if (['/research', '/research_status'].includes(command)) {
      const cycle = await this.db.researchCycle.findFirst({ orderBy: { createdAt: 'desc' } });
      response = cycle ? `Research cycle ${cycle.id}\nStatus: ${cycle.status}\nItems: ${cycle.totalItemsCollected}\nProcessed: ${cycle.totalItemsProcessed}\nEnds: ${cycle.endDate.toISOString()}` : 'No research cycle started.';
    } else if (command === '/cost') {
      const since = new Date(); since.setUTCHours(0, 0, 0, 0);
      const total = await this.db.aIUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { estimatedCost: true } });
      response = `AI cost/reservations today (UTC): $${Number(total._sum.estimatedCost ?? 0).toFixed(4)}`;
    } else if (['/status', '/health'].includes(command)) response = `Platform is responding.\nClient schedule: ${this.settings.get('CLIENT_AGENT_ENABLED')}\nResearch schedule: ${this.settings.get('RESEARCH_AGENT_ENABLED')}\nDetailed infrastructure readiness: GET /health/ready`;
    else response = 'Commands: /status /client_today /client_reviews /research_today /research_status /cost /health';
    await this.telegram.notify(`command-${bot}-${update_id}`, response, bot);
    return { ok: true };
  }
}
