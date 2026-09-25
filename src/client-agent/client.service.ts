import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { Settings } from '../common/config/settings.service';
import { QueueService } from '../queues/queues.service';
import { AIService } from '../ai/ai.service';
import { TelegramService } from '../telegram/telegram.service';
import { localClock } from '../scheduler/schedule';
import { Candidate, candidateSchema, marketSchema } from './client.schemas';
import { defaultWeights, scoreLead } from './scoring/scoring';
import { getPublicPage } from '../common/security/public-http';

const ids = (value: Prisma.JsonValue) => z.array(z.string()).parse(value);
@Injectable()
export class ClientService {
  constructor(private readonly db: PrismaService, private readonly settings: Settings, private readonly queues: QueueService,
    private readonly ai: AIService, private readonly telegram: TelegramService) {}
  async configuration() {
    const stored = await this.db.agentConfiguration.findUnique({ where: { agent: 'CLIENT' } });
    return marketSchema.parse(stored?.configuration ?? { regions: this.settings.get('CLIENT_REGIONS').split(',').map((v) => v.trim()),
      categories: this.settings.get('CLIENT_CATEGORIES').split(',').map((v) => v.trim()), dailyLimit: this.settings.get('CLIENT_AGENT_DAILY_LEAD_LIMIT'),
      weights: defaultWeights, minimumScore: 60 });
  }
  async configure(body: unknown) {
    const parsed = marketSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid market configuration');
    return this.db.agentConfiguration.upsert({ where: { agent: 'CLIENT' }, create: { agent: 'CLIENT', configuration: parsed.data }, update: { configuration: parsed.data } });
  }
  async ingest(body: unknown) {
    const parsed = candidateSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid verified candidate evidence');
    const input = parsed.data;
    const config = await this.configuration();
    const match = (value: string, list: string[]) => list.some((v) => v.toLowerCase() === value.toLowerCase());
    if (!match(input.location, config.regions) || !match(input.category, config.categories)) throw new BadRequestException('Candidate is outside configured regions/categories');
    const instagram = new URL(input.instagramUrl); instagram.search = ''; instagram.hash = '';
    const identityKey = createHash('sha256').update(instagram.hostname.replace(/^www\./, '') + instagram.pathname.toLowerCase().replace(/\/$/, '')).digest('hex');
    return this.db.businessLead.upsert({ where: { identityKey }, update: {}, create: {
      identityKey, businessName: input.businessName, category: input.category, location: input.location,
      websiteUrl: input.websiteUrl, instagramUrl: instagram.toString(),
      websiteStatus: input.factors.noWebsite ? 'NO_WEBSITE' : 'UNKNOWN',
      sources: { create: { provider: 'operator-verified', sourceUrl: input.sourceUrl, evidence: input } },
    } });
  }
  today() { return localClock(new Date(), this.settings.get('TIMEZONE')).date; }
  async trigger() {
    if (!this.settings.get('OPENAI_ENABLED')) throw new ServiceUnavailableException('Configure OpenAI before running outreach generation');
    return { jobId: await this.queues.enqueue('lead-discovery', 'discover', this.today(), { date: this.today() }) };
  }
  async discover(date: string) {
    const config = await this.configuration();
    const candidates = await this.db.businessLead.findMany({ where: { status: { in: ['DISCOVERED', 'QUALIFIED', 'ANALYZED'] }, presentedAt: null, location: { in: config.regions }, category: { in: config.categories } },
      orderBy: { discoveredAt: 'asc' }, take: 100, select: { id: true } });
    const batch = await this.db.clientBatch.upsert({ where: { date }, update: {}, create: { date, candidates: candidates.map((lead) => lead.id) } });
    await this.queues.enqueue('website-analysis', 'audit-batch', batch.id, { batchId: batch.id });
  }
  async audit(batchId: string) {
    const batch = await this.db.clientBatch.findUniqueOrThrow({ where: { id: batchId } });
    for (const id of ids(batch.candidates)) {
      const lead = await this.db.businessLead.findUniqueOrThrow({ where: { id }, include: { websiteAnalyses: { take: 1 } } });
      if (!lead.websiteUrl || lead.websiteAnalyses.length) continue;
      let status: 'REACHABLE' | 'UNREACHABLE' = 'UNREACHABLE';
      let details: { responseTimeMs?: number; httpStatus?: number; mobileViewport?: boolean } = {};
      try {
        const page = await getPublicPage(lead.websiteUrl, this.settings.get('HTTP_TIMEOUT_MS'));
        status = page.status >= 200 && page.status < 300 ? 'REACHABLE' : 'UNREACHABLE';
        details = { responseTimeMs: page.responseTimeMs, httpStatus: page.status, mobileViewport: /name\s*=\s*["']viewport["']/i.test(page.content) };
      } catch { /* Record the failed observation without claiming the business has a bad site. */ }
      await this.db.websiteAnalysis.create({ data: { leadId: id, url: lead.websiteUrl, status, https: true, ...details,
        limitations: ['Single HTTP observation; redirects are not followed.', 'Viewport tag is only a hint, not a mobile usability audit.', 'No Lighthouse, freshness, or functional contact-form assessment.'] } });
      await this.db.businessLead.update({ where: { id }, data: { websiteStatus: status } });
    }
    await this.queues.enqueue('lead-analysis', 'score-batch', batchId, { batchId });
  }
  async analyze(batchId: string) {
    const batch = await this.db.clientBatch.findUniqueOrThrow({ where: { id: batchId } });
    const config = await this.configuration();
    for (const id of ids(batch.candidates)) {
      const lead = await this.db.businessLead.findUniqueOrThrow({ where: { id }, include: { sources: true, analyses: { where: { batchId }, take: 1 } } });
      if (lead.analyses.length) continue;
      const evidence = candidateSchema.parse(lead.sources[0].evidence);
      const recent = Date.now() - new Date(evidence.verifiedAt).getTime() <= 30 * 86400000;
      const qualifies = recent && evidence.factors.operatingEvidence && evidence.factors.activeSocial && evidence.factors.clearOffering && evidence.factors.serviceFit && (evidence.factors.noWebsite || evidence.factors.poorWebsite);
      const score = scoreLead(evidence.factors, config.weights);
      const reason = evidence.factors.noWebsite ? 'No dedicated website found in the supplied verification; active social and operating evidence supplied.' : 'Verified business and web-presence opportunity; inspect supporting evidence.';
      await this.db.$transaction([
        this.db.leadAnalysis.create({ data: { leadId: id, batchId, score, factors: evidence.factors, weightsSnapshot: config.weights,
          onlinePresence: { instagramUrl: evidence.instagramUrl, facts: evidence.facts }, reason } }),
        this.db.businessLead.update({ where: { id }, data: { score, selectionReason: reason, status: qualifies && score >= config.minimumScore ? 'QUALIFIED' : 'REJECTED' } }),
      ]);
    }
    if (batch.status === 'DISCOVERED') {
      const selected = await this.db.businessLead.findMany({ where: { id: { in: ids(batch.candidates) }, status: 'QUALIFIED' },
        orderBy: [{ score: 'desc' }, { id: 'asc' }], take: config.dailyLimit });
      await this.db.clientBatch.update({ where: { id: batchId }, data: { selected: selected.map((l) => l.id), status: 'SELECTED' } });
    }
    await this.queues.enqueue('pitch-generation', 'draft-batch', batchId, { batchId });
  }
  async draftAndReport(batchId: string) {
    const batch = await this.db.clientBatch.findUniqueOrThrow({ where: { id: batchId } });
    for (const [index, id] of ids(batch.selected).entries()) {
      const lead = await this.db.businessLead.findUniqueOrThrow({ where: { id }, include: { sources: true, drafts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      const evidence: Candidate = candidateSchema.parse(lead.sources[0].evidence);
      let draft = lead.drafts[0];
      if (!draft) {
        const output = await this.ai.generatePitch({ agent: 'CLIENT', job: batchId, requestKey: `pitch-${id}` }, evidence);
        draft = await this.db.outreachDraft.create({ data: { leadId: id, content: output.message.slice(0, 1200),
          verifiedEvidence: evidence, model: this.settings.get('OPENAI_MODEL_SMALL') } });
      }
      const text = `CLIENT AGENT\n${batch.date}\nLead ${index + 1}/${ids(batch.selected).length}\n\n${lead.businessName}\n${lead.category} | ${lead.location}\nWebsite: ${lead.websiteUrl ?? 'Not found in supplied evidence'}\nInstagram: ${lead.instagramUrl}\nScore: ${lead.score}/100\nWhy selected: ${lead.selectionReason}\nSource: ${evidence.sourceUrl}\nVerified: ${evidence.verifiedAt}\n\nSuggested message (review before sending):\n${draft.content}\n\nReady for manual outreach`;
      await this.telegram.notify(`client-${batchId}-${id}`, text, "CLIENT");
      await this.db.businessLead.update({ where: { id }, data: { status: 'PRESENTED', presentedAt: new Date() } });
    }
    const content = { selectedIds: ids(batch.selected), candidateCount: ids(batch.candidates).length, selectedCount: ids(batch.selected).length,
      note: 'Only verified candidates meeting quality thresholds are included. Discovery provider pending; current source is operator-verified intake.' };
    await this.db.dailyReport.upsert({ where: { agent_date: { agent: 'CLIENT', date: batch.date } }, create: { agent: 'CLIENT', date: batch.date, content }, update: {} });
    if (!ids(batch.selected).length) await this.telegram.notify(`client-empty-${batchId}`, `CLIENT AGENT\n${batch.date}\nNo qualifying verified candidates. No leads were invented. Live discovery provider is pending.`, "CLIENT");
    await this.db.clientBatch.update({ where: { id: batchId }, data: { status: 'COMPLETED' } });
  }
}
