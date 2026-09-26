import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
  async previewDiscovery() {
    if (!this.settings.get('TAVILY_ENABLED') || !this.discovery || !this.settings.get('OPENAI_ENABLED')) {
      throw new ServiceUnavailableException('Configure Tavily and OpenAI before previewing discovery');
    }
    const config = await this.configuration();
    const result = await this.discovery.discover({ date: this.today(), regions: config.regions, categories: config.categories });
    return { mode: 'preview', date: this.today(), ...result,
      note: 'Uses API budgets and cached requests. Does not create a batch, persist leads, generate drafts, or send Telegram messages. Candidates are not qualified leads.' };
  }
  async trigger(refresh = false) {
    if (!this.settings.get('OPENAI_ENABLED')) throw new ServiceUnavailableException('Configure OpenAI before running outreach generation');
    const date = this.today();
    const revision = refresh ? await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71829345)::text`;
      const batch = await tx.clientBatch.findUnique({ where: { date } });
      if (!batch) return 0;
      if (batch.revision === 1 && batch.status !== 'COMPLETED') return 1;
      if (batch.status !== 'COMPLETED' || batch.revision !== 0 || ids(batch.candidates).length || ids(batch.selected).length || ids(batch.review).length) {
        throw new ConflictException('Refresh is allowed once, only for an empty completed batch. Existing deliveries are never reset.');
      }
      await tx.clientBatch.update({ where: { id: batch.id }, data: { revision: 1, status: 'REFRESH_PENDING',
        discovery: { previousDiscovery: batch.discovery, refreshedAt: new Date().toISOString() } } });
      return 1;
    }, { maxWait: 15000, timeout: 15000 }) : 0;
    return { jobId: await this.queues.enqueue('lead-discovery', 'discover', revision ? `${date}-r${revision}` : date, { date, revision }), revision };
  }
  async discover(date: string, revision = 0) {
    const config = await this.configuration();
    let batch = await this.db.clientBatch.findUnique({ where: { date } });
    if (batch && batch.revision !== revision) return;
    if (batch && batch.status !== 'REFRESH_PENDING') {
      await this.queues.enqueue('website-analysis', 'audit-batch', `${batch.id}-r${revision}`, { batchId: batch.id, revision }); return;
    }
    let discovery: Prisma.InputJsonObject = { provider: 'operator-verified' };
    if (this.settings.get('TAVILY_ENABLED') && this.discovery) {
      const result = await this.discovery.discover({ date, regions: config.regions, categories: config.categories });
      for (const business of result.businesses) await this.ingest(business.candidate, business.provenance);
      discovery = { provider: 'tavily', queries: result.queries, errors: result.errors, duplicates: result.duplicates,
        extractedCandidates: result.extractedCandidates, rejections: result.rejections, missingRecentActivity: result.missingRecentActivity,
        enrichmentFailures: result.enrichmentFailures,
        candidatesDiscovered: result.businesses.length, uncertainWebsites: result.uncertainWebsites };
      if (result.errors) await this.telegram.notify(`client-discovery-errors-${date}`,
        `CLIENT AGENT\nDiscovery had ${result.errors} failed queries or verification steps. Available candidates continue; inspect /admin/tavily/status and run logs.`, 'CLIENT');
    }
    const candidates = await this.db.businessLead.findMany({ where: { status: { in: ['DISCOVERED', 'QUALIFIED', 'ANALYZED', 'NEEDS_REVIEW'] }, presentedAt: null, location: { in: config.regions }, category: { in: config.categories } },
      orderBy: { discoveredAt: 'asc' }, take: 100, select: { id: true } });
    batch = batch ? await this.db.clientBatch.update({ where: { id: batch.id }, data: { status: 'DISCOVERED',
      discovery: { ...discovery, refreshHistory: batch.discovery }, candidates: candidates.map((lead) => lead.id) } }) :
      await this.db.clientBatch.upsert({ where: { date }, update: {}, create: { date, discovery, candidates: candidates.map((lead) => lead.id) } });
    await this.queues.enqueue('website-analysis', 'audit-batch', `${batch.id}-r${revision}`, { batchId: batch.id, revision });
  }
  async audit(batchId: string, revision?: number) {
    const batch = await this.db.clientBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (revision !== undefined && revision !== batch.revision) return;
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
    await this.queues.enqueue('lead-analysis', 'score-batch', `${batchId}-r${batch.revision}`, { batchId, revision: batch.revision });
  }
  async analyze(batchId: string, revision?: number) {
    const batch = await this.db.clientBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (revision !== undefined && revision !== batch.revision) return;
    const config = await this.configuration();
    for (const id of ids(batch.candidates)) {
      const lead = await this.db.businessLead.findUniqueOrThrow({ where: { id }, include: { sources: true, analyses: { where: { batchId }, take: 1 } } });
      if (lead.analyses.length || lead.presentedAt || !['DISCOVERED', 'QUALIFIED', 'ANALYZED', 'NEEDS_REVIEW'].includes(lead.status)) continue;
      const evidence = readCandidate(lead.sources[0].evidence);
      const recent = Date.now() - new Date(evidence.verifiedAt).getTime() <= 30 * 86400000;
      const qualifies = recent && evidence.factors.operatingEvidence && evidence.factors.activeSocial && evidence.factors.clearOffering && evidence.factors.serviceFit && (evidence.factors.noWebsite || evidence.factors.poorWebsite);
      const score = scoreLead(evidence.factors, config.weights);
      const qualified = qualifies && score >= config.minimumScore;
      const reviewable = this.settings.get('CLIENT_REVIEW_ENABLED') && recent && !evidence.websiteUrl && evidence.factors.clearOffering && evidence.factors.serviceFit;
      const reason = qualified ? 'Verified web-presence opportunity with active social and operating evidence; review quoted sources.' :
        reviewable ? 'Manual review required: website absence and/or current activity is unconfirmed. Open the profile and verify before outreach.' : 'Insufficient evidence for qualification or manual review.';
      await this.db.$transaction([
        this.db.leadAnalysis.create({ data: { leadId: id, batchId, score, factors: evidence.factors, weightsSnapshot: config.weights,
          onlinePresence: { instagramUrl: evidence.instagramUrl, facts: evidence.facts }, reason } }),
        this.db.businessLead.updateMany({ where: { id, presentedAt: null, status: { in: ['DISCOVERED', 'QUALIFIED', 'ANALYZED', 'NEEDS_REVIEW'] } },
          data: { score, selectionReason: reason, status: qualified ? 'QUALIFIED' : reviewable ? 'NEEDS_REVIEW' : 'REJECTED' } }),
      ]);
    }
    if (batch.status === 'DISCOVERED') {
      const selected = await this.db.businessLead.findMany({ where: { id: { in: ids(batch.candidates) }, status: 'QUALIFIED' },
        orderBy: [{ score: 'desc' }, { id: 'asc' }], take: config.dailyLimit });
      const review = this.settings.get('CLIENT_REVIEW_ENABLED') && selected.length < config.dailyLimit ? await this.db.businessLead.findMany({
        where: { id: { in: ids(batch.candidates) }, status: 'NEEDS_REVIEW', presentedAt: null },
        orderBy: [{ score: 'desc' }, { id: 'asc' }], take: config.dailyLimit - selected.length }) : [];
      await this.db.clientBatch.update({ where: { id: batchId }, data: { selected: selected.map((l) => l.id), review: review.map((l) => l.id), status: 'SELECTED' } });
    }
    await this.queues.enqueue('pitch-generation', 'draft-batch', `${batchId}-r${batch.revision}`, { batchId, revision: batch.revision });
  }
  async draftAndReport(batchId: string, revision?: number) {
    const batch = await this.db.clientBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (revision !== undefined && revision !== batch.revision) return;
    let draftFallbacks = 0;
    for (const [index, id] of ids(batch.selected).entries()) {
      const lead = await this.db.businessLead.findUniqueOrThrow({ where: { id }, include: { sources: true, drafts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      if (!['QUALIFIED', 'PRESENTED'].includes(lead.status)) continue;
      const evidence: Candidate = readCandidate(lead.sources[0].evidence);
      let draft = lead.drafts[0];
      if (!draft) {
        let content: string, model = this.settings.get('OPENAI_MODEL_SMALL');
        try {
          const output = await this.ai.generatePitch({ agent: 'CLIENT', job: batchId, requestKey: `pitch-${id}` }, evidence);
          content = output.message.slice(0, 1200);
        } catch {
          content = neutralDraft(lead.businessName); model = 'neutral-template-fallback-v1';
          await this.db.systemError.create({ data: { agent: 'CLIENT', queue: 'pitch-generation', jobId: batchId,
            message: 'AI draft unavailable; used a neutral template. Inspect the AI usage ledger before retrying paid requests.' } });
        }
        draft = await this.db.outreachDraft.create({ data: { leadId: id, content, verifiedEvidence: evidence, model } });
      }
      if (draft.model === 'neutral-template-fallback-v1') draftFallbacks++;
      const text = `CLIENT AGENT\n${batch.date}\nLead ${index + 1}/${ids(batch.selected).length}\n\n${lead.businessName}\n${lead.category} | ${lead.location}\nWebsite status: ${lead.websiteStatus}\nWebsite: ${lead.websiteUrl ?? 'None verified'}\nSocial: ${lead.instagramUrl ?? evidence.socialUrls[0]}\nScore: ${lead.score}/100\nWhy selected: ${lead.selectionReason}\nSource: ${evidence.sourceUrl}\nVerified: ${evidence.verifiedAt}\n\nSuggested message (review before sending):\n${draft.content}\n\nReady for manual outreach`;
      await this.telegram.notify(`client-${batchId}-${id}`, text, "CLIENT");
      await this.db.businessLead.updateMany({ where: { id, status: 'QUALIFIED', presentedAt: null }, data: { status: 'PRESENTED', presentedAt: new Date() } });
    }
    for (const id of ids(batch.review)) {
      const lead = await this.db.businessLead.findUniqueOrThrow({ where: { id }, include: { sources: true, drafts: { take: 1 } } });
      if (!['NEEDS_REVIEW', 'REVIEW_PRESENTED'].includes(lead.status)) continue;
      const evidence = readCandidate(lead.sources[0].evidence);
      let draft = lead.drafts[0];
      if (!draft) draft = await this.db.outreachDraft.create({ data: { leadId: id,
        content: neutralDraft(lead.businessName),
        verifiedEvidence: evidence, model: 'manual-review-template-v1' } });
      await this.telegram.notify(`client-review-${batchId}-${id}`,
        `CLIENT AGENT | MANUAL REVIEW - NOT QUALIFIED\n${batch.date}\n${lead.businessName}\n${lead.category} | ${lead.location}\nProfile: ${lead.instagramUrl ?? evidence.socialUrls[0]}\nWebsite: ${evidence.factors.noWebsite ? 'Explicit no-website statement found; confirm it is current' : 'UNKNOWN - absence is not confirmed'}\nRecent activity: ${evidence.factors.recentActivity ? 'Dated evidence found' : 'UNVERIFIED'}\nObserved: ${evidence.facts.slice(0, 2).map((f) => f.claim.slice(0, 200)).join(' | ')}\nSource: ${evidence.sourceUrl}\n\nBefore outreach: check recent posts, bio links and whether a dedicated website exists. Skip if inactive or unsuitable.\n\nOptional draft AFTER your verification:\n${draft.content}`, 'CLIENT');
      await this.db.businessLead.updateMany({ where: { id, status: 'NEEDS_REVIEW', presentedAt: null }, data: { status: 'REVIEW_PRESENTED', presentedAt: new Date() } });
    }
    const content = { selectedIds: ids(batch.selected), reviewIds: ids(batch.review), candidateCount: ids(batch.candidates).length,
      selectedCount: ids(batch.selected).length, reviewCount: ids(batch.review).length, draftFallbacks,
      discovery: batch.discovery, note: 'Qualified leads and unqualified manual-review candidates are counted separately. Combined daily limit applies. No automated outreach.' };
    await this.db.dailyReport.upsert({ where: { agent_date: { agent: 'CLIENT', date: batch.date } }, create: { agent: 'CLIENT', date: batch.date, content }, update: { content } });
    if (!ids(batch.selected).length && !ids(batch.review).length) await this.telegram.notify(`client-empty-${batchId}-r${batch.revision}`, `CLIENT AGENT\n${batch.date}\nNo qualified leads or review candidates among ${ids(batch.candidates).length} candidates. Inspect the protected daily report for discovery errors and counts.`, "CLIENT");
    await this.db.clientBatch.update({ where: { id: batchId }, data: { status: 'COMPLETED' } });
  }
}
function neutralDraft(businessName: string) {
  return `Hi ${businessName}, I build websites for local businesses. Would you be open to discussing a website for customer enquiries?`;
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
