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
import { normalizedProfile, TavilyBusinessSource } from './discovery/tavily.source';
import { BusinessEvidence } from './discovery/discovery-source';

const ids = (value: Prisma.JsonValue) => z.array(z.string()).parse(value);
@Injectable()
export class ClientService {
  constructor(private readonly db: PrismaService, private readonly settings: Settings, private readonly queues: QueueService,
    private readonly ai: AIService, private readonly telegram: TelegramService, private readonly discovery?: TavilyBusinessSource) {}
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
  async ingest(body: unknown, provenance?: BusinessEvidence['provenance']) {
    const parsed = candidateSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid verified candidate evidence');
    const input = parsed.data;
    const config = await this.configuration();
    const match = (value: string, list: string[]) => list.some((v) => v.toLowerCase() === value.toLowerCase());
    if (!match(input.location, config.regions) || !match(input.category, config.categories)) throw new BadRequestException('Candidate is outside configured regions/categories');
    input.location = config.regions.find((v) => v.toLowerCase() === input.location.toLowerCase())!;
    input.category = config.categories.find((v) => v.toLowerCase() === input.category.toLowerCase())!;
    const profile = normalizedProfile(input.instagramUrl ?? input.socialUrls[0]);
    const profileUrl = new URL(profile);
    const identityKey = createHash('sha256').update(profileUrl.hostname + profileUrl.pathname.replace(/\/$/, '')).digest('hex');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71829344)::text`;
      const existing = await tx.businessLead.findFirst({ where: { OR: [ { identityKey },
        { businessName: { equals: input.businessName.trim(), mode: 'insensitive' }, location: { equals: input.location, mode: 'insensitive' } },
        ...websiteIdentityFilters(input.websiteUrl),
      ] } });
      if (existing) return existing;
      return tx.businessLead.create({ data: {
        identityKey, businessName: input.businessName.trim(), category: input.category, location: input.location,
        websiteUrl: input.websiteUrl, instagramUrl: input.instagramUrl ? profile : null, socialUrls: [...new Set([profile, ...input.socialUrls.map(normalizedProfile)])],
        websiteStatus: input.factors.noWebsite ? 'NO_WEBSITE' : 'UNKNOWN',
        sources: { create: { provider: provenance?.provider ?? 'operator-verified', sourceUrl: input.sourceUrl, evidence: provenance ? { ...input, discovery: provenance } : input } },
      } });
    }, { maxWait: 15000, timeout: 15000 });
  }
  today() { return localClock(new Date(), this.settings.get('TIMEZONE')).date; }
  async trigger() {
    if (!this.settings.get('OPENAI_ENABLED')) throw new ServiceUnavailableException('Configure OpenAI before running outreach generation');
    return { jobId: await this.queues.enqueue('lead-discovery', 'discover', this.today(), { date: this.today() }) };
  }
  async discover(date: string) {
    const config = await this.configuration();
    let batch = await this.db.clientBatch.findUnique({ where: { date } });
    if (batch) { await this.queues.enqueue('website-analysis', 'audit-batch', batch.id, { batchId: batch.id }); return; }
    let discovery: Prisma.InputJsonObject = { provider: 'operator-verified' };
    if (this.settings.get('TAVILY_ENABLED') && this.discovery) {
      const result = await this.discovery.discover({ date, regions: config.regions, categories: config.categories });
      for (const business of result.businesses) await this.ingest(business.candidate, business.provenance);
      discovery = { provider: 'tavily', queries: result.queries, errors: result.errors, duplicates: result.duplicates,
        candidatesDiscovered: result.businesses.length, uncertainWebsites: result.uncertainWebsites };
      if (result.errors) await this.telegram.notify(`client-discovery-errors-${date}`,
        `CLIENT AGENT\nDiscovery had ${result.errors} failed queries or verification steps. Available candidates continue; inspect /admin/tavily/status and run logs.`, 'CLIENT');
    }
    const candidates = await this.db.businessLead.findMany({ where: { status: { in: ['DISCOVERED', 'QUALIFIED', 'ANALYZED'] }, presentedAt: null, location: { in: config.regions }, category: { in: config.categories } },
      orderBy: { discoveredAt: 'asc' }, take: 100, select: { id: true } });
    batch = await this.db.clientBatch.upsert({ where: { date }, update: {}, create: { date, discovery, candidates: candidates.map((lead) => lead.id) } });
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
      const evidence = readCandidate(lead.sources[0].evidence);
      const recent = Date.now() - new Date(evidence.verifiedAt).getTime() <= 30 * 86400000;
      const qualifies = recent && evidence.factors.operatingEvidence && evidence.factors.activeSocial && evidence.factors.clearOffering && evidence.factors.serviceFit && (evidence.factors.noWebsite || evidence.factors.poorWebsite);
      const score = scoreLead(evidence.factors, config.weights);
      const reason = evidence.factors.noWebsite ? 'Explicit no-website evidence with active social and operating evidence; review quoted sources.' : 'Web-presence opportunity requires supporting evidence; missing website information remains unknown.';
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
      const evidence: Candidate = readCandidate(lead.sources[0].evidence);
      let draft = lead.drafts[0];
      if (!draft) {
        const output = await this.ai.generatePitch({ agent: 'CLIENT', job: batchId, requestKey: `pitch-${id}` }, evidence);
        draft = await this.db.outreachDraft.create({ data: { leadId: id, content: output.message.slice(0, 1200),
          verifiedEvidence: evidence, model: this.settings.get('OPENAI_MODEL_SMALL') } });
      }
      const text = `CLIENT AGENT\n${batch.date}\nLead ${index + 1}/${ids(batch.selected).length}\n\n${lead.businessName}\n${lead.category} | ${lead.location}\nWebsite status: ${lead.websiteStatus}\nWebsite: ${lead.websiteUrl ?? 'None verified'}\nSocial: ${lead.instagramUrl ?? evidence.socialUrls[0]}\nScore: ${lead.score}/100\nWhy selected: ${lead.selectionReason}\nSource: ${evidence.sourceUrl}\nVerified: ${evidence.verifiedAt}\n\nSuggested message (review before sending):\n${draft.content}\n\nReady for manual outreach`;
      await this.telegram.notify(`client-${batchId}-${id}`, text, "CLIENT");
      await this.db.businessLead.update({ where: { id }, data: { status: 'PRESENTED', presentedAt: new Date() } });
    }
    const content = { selectedIds: ids(batch.selected), candidateCount: ids(batch.candidates).length, selectedCount: ids(batch.selected).length,
      discovery: batch.discovery, note: 'Only evidence-backed candidates meeting quality thresholds are included. No automated outreach.' };
    await this.db.dailyReport.upsert({ where: { agent_date: { agent: 'CLIENT', date: batch.date } }, create: { agent: 'CLIENT', date: batch.date, content }, update: {} });
    if (!ids(batch.selected).length) await this.telegram.notify(`client-empty-${batchId}`, `CLIENT AGENT\n${batch.date}\nNo qualifying verified candidates among ${ids(batch.candidates).length} candidates. Unknown website/activity evidence does not qualify. Inspect the protected daily report for discovery errors and counts.`, "CLIENT");
    await this.db.clientBatch.update({ where: { id: batchId }, data: { status: 'COMPLETED' } });
  }
}
function readCandidate(value: Prisma.JsonValue) {
  const object = z.record(z.unknown()).parse(value);
  delete object.discovery;
  return candidateSchema.parse(object);
}
export function websiteIdentityFilters(url: string | null): Prisma.BusinessLeadWhereInput[] {
  if (!url) return [];
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  return [host, `www.${host}`].flatMap((domain) => [
    { websiteUrl: { equals: `https://${domain}`, mode: 'insensitive' as const } },
    { websiteUrl: { startsWith: `https://${domain}/`, mode: 'insensitive' as const } },
    { websiteUrl: { startsWith: `https://${domain}?`, mode: 'insensitive' as const } },
  ]);
}
