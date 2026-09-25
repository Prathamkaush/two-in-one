import { BadRequestException, Injectable, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { Settings } from '../common/config/settings.service';
import { QueueService } from '../queues/queues.service';
import { AIService } from '../ai/ai.service';
import { TelegramService } from '../telegram/telegram.service';
import { UsageService } from '../usage/usage.service';
import { localClock } from '../scheduler/schedule';
import { publicUrl } from '../common/security/public-http';
import { RssSource } from './sources/rss.source';
import { canonicalUrl, clusterKey, contentHash, normalizeContent } from './normalization';
import { finalReportSchema } from './opportunity.schema';

export const researchInput = z.object({ sourceUrl: z.string().url().max(2048), title: z.string().min(1).max(500), content: z.string().min(20).max(50000), publishedAt: z.string().datetime().optional() }).strict();
@Injectable()
export class ResearchService {
  constructor(private readonly db: PrismaService, private readonly settings: Settings, private readonly queues: QueueService,
    private readonly ai: AIService, private readonly telegram: TelegramService, private readonly usage: UsageService) {}
  async startCycle() {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71829342)::text`;
      if (await tx.researchCycle.findFirst({ where: { status: { in: ['ACTIVE', 'ANALYZING'] } } })) throw new ConflictException('A research cycle is already running');
      const startDate = new Date();
      return tx.researchCycle.create({ data: { startDate, endDate: new Date(startDate.getTime() + this.settings.get('RESEARCH_CYCLE_DAYS') * 86400000),
        timezone: this.settings.get('TIMEZONE'), status: 'ACTIVE', currentDay: 1 } });
    }, { maxWait: 15000 });
  }
  async addSource(body: unknown) {
    const parsed = z.object({ name: z.string().min(2).max(100), adapter: z.enum(['rss', 'operator']), url: z.string().url().optional() }).strict().safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid source');
    if (parsed.data.adapter === 'rss') { if (!parsed.data.url) throw new BadRequestException('RSS URL required'); publicUrl(parsed.data.url); }
    return this.db.researchSource.create({ data: { name: parsed.data.name, adapter: parsed.data.adapter, enabled: true,
      configuration: parsed.data.url ? { url: parsed.data.url } : {} } });
  }
  async collectNow() {
    const cycle = await this.db.researchCycle.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    if (new Date() >= cycle.endDate) throw new ConflictException('Cycle collection window has ended');
    const sources = await this.db.researchSource.findMany({ where: { enabled: true, adapter: 'rss' } });
    const slot = new Date().toISOString().slice(0, 16);
    const jobs = [];
    for (const source of sources) jobs.push(await this.queues.enqueue('research-collection', 'collect', `${cycle.id}-${source.id}-${slot}`, { cycleId: cycle.id, sourceId: source.id }));
    return { jobs, note: sources.length ? undefined : 'No RSS sources configured. Add permitted feeds or import verified evidence.' };
  }
  async collect(cycleId: string, sourceId: string) {
    const cycle = await this.db.researchCycle.findUniqueOrThrow({ where: { id: cycleId } });
    if (cycle.status !== 'ACTIVE' || new Date() >= cycle.endDate) return;
    const source = await this.db.researchSource.findUniqueOrThrow({ where: { id: sourceId } });
    if (!source.enabled || source.adapter !== 'rss') return;
    const config = z.object({ url: z.string().url() }).parse(source.configuration);
    const items = await new RssSource(config.url).collect({ since: cycle.startDate, limit: 50 });
    for (const item of items) {
      try {
        await this.ingest(cycleId, sourceId, { sourceUrl: item.sourceUrl, title: item.title, content: item.content,
          ...(item.publishedAt ? { publishedAt: item.publishedAt.toISOString() } : {}) });
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
      }
    }
  }
  async ingest(cycleId: string, sourceId: string, body: unknown) {
    const result = researchInput.safeParse(body); if (!result.success) throw new BadRequestException('Invalid research evidence');
    const input = result.data;
    publicUrl(input.sourceUrl);
    const content = normalizeContent(input.content).slice(0, 16000);
    if (content.length < 20) throw new BadRequestException('Insufficient source text');
    const item = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71829342)::text`;
      const cycle = await tx.researchCycle.findUniqueOrThrow({ where: { id: cycleId } });
      if (cycle.status !== 'ACTIVE' || new Date() >= cycle.endDate) throw new ConflictException('Cycle is closed to collection');
      const url = canonicalUrl(input.sourceUrl), hash = contentHash(content);
      const existing = await tx.researchItem.findUnique({ where: { cycleId_canonicalUrl: { cycleId, canonicalUrl: url } } });
      if (existing) return existing;
      const duplicate = await tx.researchItem.findFirst({ where: { cycleId, contentHash: hash } });
      const created = await tx.researchItem.create({ data: { cycleId, sourceId, sourceUrl: input.sourceUrl, canonicalUrl: url, contentHash: hash,
        title: input.title, content, publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
        status: duplicate ? 'DUPLICATE' : 'PENDING', duplicateOfId: duplicate?.id } });
      await tx.researchCycle.update({ where: { id: cycleId }, data: { totalItemsCollected: { increment: 1 } } });
      return created;
    }, { maxWait: 15000, timeout: 15000 });
    if (item.status === 'PENDING') await this.queues.enqueue('research-processing', 'extract', item.id, { itemId: item.id });
    return item;
  }
  async process(itemId: string) {
    const item = await this.db.researchItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.status !== 'PENDING') {
      if (item.status === 'PROCESSED') await this.queues.enqueue('research-analysis', 'cluster', item.id, { itemId: item.id });
      return;
    }
    const output = await this.ai.classifyResearch({ agent: 'RESEARCH', job: itemId, requestKey: `extract-${itemId}` }, { id: item.id, title: item.title, content: item.content, sourceUrl: item.sourceUrl });
    const verifiedSignals = output.signals.filter((s) => s.confidence >= 0 && s.confidence <= 1 && item.content.includes(s.evidenceQuote) && s.evidenceQuote.length >= 10).slice(0, 10);
    await this.db.$transaction(async (tx) => {
      const claimed = await tx.researchItem.updateMany({ where: { id: itemId, status: 'PENDING' }, data: {
        status: output.relevant ? 'PROCESSED' : 'IRRELEVANT', topic: output.topic, summary: output.summary, confidence: Math.max(0, Math.min(1, output.confidence)) } });
      if (!claimed.count) return;
      if (output.relevant) for (const signal of verifiedSignals) await tx.researchSignal.create({ data: { itemId, ...signal } });
      await tx.researchCycle.update({ where: { id: item.cycleId }, data: { totalItemsProcessed: { increment: 1 } } });
    });
    await this.queues.enqueue('research-analysis', 'cluster', item.id, { itemId: item.id });
  }
  async cluster(itemId: string) {
    const item = await this.db.researchItem.findUniqueOrThrow({ where: { id: itemId }, include: { signals: true } });
    for (const signal of item.signals) {
      const key = clusterKey(signal.category, signal.problem);
      const cluster = await this.db.researchCluster.upsert({ where: { cycleId_key: { cycleId: item.cycleId, key } }, update: {},
        create: { cycleId: item.cycleId, key, label: signal.problem } });
      await this.db.researchSignal.update({ where: { id: signal.id }, data: { clusterId: cluster.id } });
    }
  }
  async dailySummary() {
    const cycle = await this.db.researchCycle.findFirst({ where: { status: { in: ['ACTIVE', 'ANALYZING'] } }, orderBy: { createdAt: 'desc' } });
    if (!cycle) return { status: 'No active cycle' };
    const date = localClock(new Date(), cycle.timezone).date;
    const items = await this.db.researchItem.findMany({ where: { cycleId: cycle.id, collectedAt: { gte: new Date(Date.now() - 48 * 3600000) } }, select: { collectedAt: true, status: true, source: { select: { name: true } } } });
    const today = items.filter((item) => localClock(item.collectedAt, cycle.timezone).date === date);
    const bySource: Record<string, number> = {}; for (const item of today) bySource[item.source.name] = (bySource[item.source.name] ?? 0) + 1;
    const costs = await this.usage.summary();
    const day = Math.min(Math.max(1, Math.ceil((cycle.endDate.getTime() - cycle.startDate.getTime()) / 86400000)), Math.floor((Date.now() - cycle.startDate.getTime()) / 86400000) + 1);
    const content = { date, day, totalItemsExamined: today.length, sources: bySource, pending: today.filter((i) => i.status === 'PENDING').length,
      processed: today.filter((i) => i.status === 'PROCESSED').length, dataStored: true, platformCostUtcDay: costs.daily,
      status: today.length ? 'Collection recorded; inspect pending count' : 'No items collected; check configured sources' };
    await this.db.dailyReport.upsert({ where: { agent_date: { agent: 'RESEARCH', date } }, create: { agent: 'RESEARCH', date, cycleId: cycle.id, content }, update: { content } });
    await this.db.researchCycle.update({ where: { id: cycle.id }, data: { currentDay: day } });
    await this.telegram.notify(`research-summary-${date}`, `RESEARCH AGENT\n${date}\nStatus: ${content.status}\nCycle day: ${day}\nSources: ${JSON.stringify(bySource)}\nItems stored: ${today.length}\nPending: ${content.pending}\nPlatform AI cost (UTC day): $${costs.daily.toFixed(4)}\nOperational report only; no opportunity recommendations during collection.`, "RESEARCH");
    return content;
  }
  async finalize(cycleId: string, simulate = false) {
    if (simulate && this.settings.get('NODE_ENV') === 'production') throw new BadRequestException('Simulation is disabled in production');
    const cycle = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71829342)::text`;
      const row = await tx.researchCycle.findUniqueOrThrow({ where: { id: cycleId } });
      if (row.status === 'COMPLETED') return row;
      if (row.status !== 'ACTIVE' && row.status !== 'ANALYZING') throw new ConflictException('Cycle is not ready');
      if (new Date() < row.endDate && !simulate) throw new ConflictException('Research period has not ended');
      if (await tx.researchItem.count({ where: { cycleId, status: 'PENDING' } })) throw new ConflictException('Finish or resolve pending extraction before finalization');
      return tx.researchCycle.update({ where: { id: cycleId }, data: { status: 'ANALYZING', ...(simulate ? { endDate: new Date() } : {}) } });
    }, { maxWait: 15000, timeout: 15000 });
    if (cycle.status !== 'COMPLETED') await this.queues.enqueue('monthly-analysis', 'final-report', cycle.id, { cycleId: cycle.id });
    return cycle;
  }
  async monthly(cycleId: string) {
    const cycle = await this.db.researchCycle.findUniqueOrThrow({ where: { id: cycleId }, include: { report: true } });
    if (cycle.status === 'COMPLETED') { if (cycle.report) await this.notifyCompletion(cycleId, cycle.report.id); return; }
    if (cycle.status !== 'ANALYZING' || new Date() < cycle.endDate) throw new ConflictException('Monthly synthesis is only allowed after the research window');
    const items = await this.db.researchItem.findMany({ where: { cycleId, status: 'PROCESSED', signals: { some: {} } },
      orderBy: [{ confidence: 'desc' }, { id: 'asc' }], take: 60, include: { signals: true } });
    for (const item of items) await this.cluster(item.id);
    const evidence = items.map((item) => ({ id: item.id, url: item.sourceUrl, title: item.title.slice(0, 120),
      signals: item.signals.slice(0, 2).map((s) => ({ problem: s.problem.slice(0, 150), quote: s.evidenceQuote.slice(0, 200) })) }));
    while (Buffer.byteLength(JSON.stringify(evidence), 'utf8') > 36000) evidence.pop();
    let result: z.infer<typeof finalReportSchema> = { opportunities: [], insufficiencyReason: 'Insufficient traceable evidence: at least 3 processed items across 2 source domains are required.' };
    if (items.length >= 3 && new Set(items.map((i) => new URL(i.sourceUrl).hostname)).size >= 2) {
      result = await this.ai.extractStructuredData({ agent: 'RESEARCH', job: cycleId, requestKey: `monthly-${cycleId}`, strong: true },
        'The collection cycle is closed. Produce up to exactly 10 distinct opportunities only when evidence supports them. Return fewer and explain insufficiency otherwise. Each opportunity needs at least 2 supplied item IDs in sourceReferences. Never invent competitors, demand, willingness-to-pay, or factual gaps: explicitly label unknowns and hypotheses. Confidence and dimension scores must be 0 to 1. Include validation experiments. This is a bounded evidence sample; do not claim exhaustive market research.', evidence, finalReportSchema);
    }
    const allowed = new Set(evidence.map((i) => i.id));
    const opportunities = result.opportunities.filter((o) => o.confidence >= 0 && o.confidence <= 1 &&
      new Set(o.sourceReferences).size >= 2 && o.sourceReferences.every((id) => allowed.has(id)) &&
      Object.values(o.dimensions).every((value) => value >= 0 && value <= 1)).slice(0, 10);
    const insufficiencyReason = opportunities.length < 10 ? result.insufficiencyReason ?? 'Fewer than 10 opportunities passed evidence-reference validation.' : null;
    const content = { opportunities, insufficiencyReason, evidenceSampleSize: evidence.length, limitations: ['Bounded evidence sample; no automatic deep competitor research in V1.', 'Scores and market interpretations require operator validation.'] };
    const report = await this.db.$transaction(async (tx) => {
      const report = await tx.monthlyReport.create({ data: { cycleId, content, insufficiencyReason } });
      for (const [index, opportunity] of opportunities.entries()) {
        const signal = await tx.researchSignal.findFirst({ where: { itemId: opportunity.sourceReferences[0], clusterId: { not: null } } });
        if (signal?.clusterId) await tx.opportunityCandidate.upsert({ where: { cycleId_clusterId: { cycleId, clusterId: signal.clusterId } },
          create: { cycleId, clusterId: signal.clusterId, name: opportunity.name, analysis: opportunity, dimensions: opportunity.dimensions, evidenceReferences: opportunity.sourceReferences }, update: {} });
        await tx.finalOpportunity.create({ data: { ...opportunity, cycleId, reportId: report.id, rank: index + 1 } });
      }
      const allItemIds = (await tx.researchItem.findMany({ where: { cycleId }, select: { id: true } })).map((i) => i.id);
      const totalCost = (await tx.aIUsage.aggregate({ where: { job: { in: [cycleId, ...allItemIds] } }, _sum: { estimatedCost: true } }))._sum.estimatedCost ?? 0;
      await tx.researchCycle.update({ where: { id: cycleId }, data: { status: 'COMPLETED', completedAt: new Date(), totalCost } });
      return report;
    }, { timeout: 15000 });
    await this.notifyCompletion(cycleId, report.id);
  }
  private async notifyCompletion(cycleId: string, reportId: string) {
    const count = await this.db.finalOpportunity.count({ where: { reportId } });
    await this.telegram.notify(`monthly-${cycleId}`, `MONTHLY BUSINESS RESEARCH COMPLETE\nCycle: ${cycleId}\nFinal opportunities: ${count}\nFull report: GET /admin/research/reports/${reportId} (requires operator authentication).\nIf evidence was insufficient, the report explains the shortfall.`, "RESEARCH");
  }
}
