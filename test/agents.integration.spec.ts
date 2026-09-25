import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service';
import { Settings } from '../src/common/config/settings.service';
import { QueueService } from '../src/queues/queues.service';
import { AIService } from '../src/ai/ai.service';
import { TelegramService } from '../src/telegram/telegram.service';
import { UsageService } from '../src/usage/usage.service';
import { ClientService } from '../src/client-agent/client.service';
import { ResearchService } from '../src/research-agent/research.service';
import { TavilyService } from '../src/tavily/tavily.service';
import { TavilyBusinessSource } from '../src/client-agent/discovery/tavily.source';
import { validateEnvironment } from '../src/common/config/environment';

describe('agent happy paths with real PostgreSQL and mocked paid integrations', () => {
  const db = new PrismaService();
  const settings = new Settings(new ConfigService({ CLIENT_REGIONS: 'Delhi,Gurugram,Noida,Faridabad,Ghaziabad',
    CLIENT_CATEGORIES: 'Bakeries,Salons and beauty parlours', CLIENT_AGENT_DAILY_LEAD_LIMIT: 6, OPENAI_MODEL_SMALL: 'fixture',
    TIMEZONE: 'Asia/Kolkata', RESEARCH_CYCLE_DAYS: 1, NODE_ENV: 'test', HTTP_TIMEOUT_MS: 1000 }));
  const queueMock = { enqueue: jest.fn().mockResolvedValue('job') };
  const telegramMock = { notify: jest.fn().mockResolvedValue('notification') };
  const aiMock = { generatePitch: jest.fn().mockResolvedValue({ message: 'Hello, would a dedicated website be useful for your bakery?', supportingEvidence: [] }),
    classifyResearch: jest.fn(), extractStructuredData: jest.fn() };
  const queues = queueMock as unknown as QueueService, telegram = telegramMock as unknown as TelegramService, ai = aiMock as unknown as AIService;
  beforeAll(async () => { if (!process.env.INTEGRATION_TEST_DATABASE?.startsWith('automation_test_')) throw new Error('Use integration runner'); await db.$connect(); });
  afterAll(async () => { await db.$disconnect(); });
  it('selects six verified Delhi NCR leads, persists drafts, and avoids repeat presentation', async () => {
    const client = new ClientService(db, settings, queues, ai, telegram);
    for (let index = 0; index < 7; index++) {
      await client.ingest({ businessName: `Fixture Bakery ${index}`, category: 'Bakeries', location: 'Delhi', websiteUrl: null,
        instagramUrl: `https://www.instagram.com/fixture_bakery_${index}/`, sourceUrl: `https://example.com/business/${index}`, verifiedAt: new Date().toISOString(),
        facts: [{ claim: 'Fixture business sells cakes and publishes recent social posts.', sourceUrl: 'https://example.com/evidence' }],
        factors: { noWebsite: true, poorWebsite: false, activeSocial: true, clearOffering: true, recentActivity: true, operatingEvidence: true, weakContact: false, serviceFit: true } });
    }
    await client.discover('2026-09-24');
    const batch = await db.clientBatch.findUniqueOrThrow({ where: { date: '2026-09-24' } });
    await client.audit(batch.id); await client.analyze(batch.id); await client.draftAndReport(batch.id);
    expect(await db.businessLead.count({ where: { status: 'PRESENTED' } })).toBe(6);
    expect(await db.outreachDraft.count()).toBe(6);
    expect(aiMock.generatePitch).toHaveBeenCalledTimes(6);
    expect(telegramMock.notify).toHaveBeenCalledTimes(6);
    expect(await db.dailyReport.findUnique({ where: { agent_date: { agent: 'CLIENT', date: '2026-09-24' } } })).not.toBeNull();
    await client.discover('2026-09-25');
    const next = await db.clientBatch.findUniqueOrThrow({ where: { date: '2026-09-25' } });
    expect(next.candidates).toHaveLength(1);
  });
  it('collects/deduplicates/extracts evidence, reports operations, and only synthesizes after closure', async () => {
    const usage = { summary: jest.fn().mockResolvedValue({ daily: 0, monthly: 0 }) } as unknown as UsageService;
    const research = new ResearchService(db, settings, queues, ai, telegram, usage);
    const source = await research.addSource({ name: 'e2e-operator', adapter: 'operator' });
    const cycle = await research.startCycle();
    await expect(research.startCycle()).rejects.toThrow('already running');
    await expect(research.finalize(cycle.id)).rejects.toThrow('not ended');
    await expect(research.monthly(cycle.id)).rejects.toThrow('only allowed');
    const itemIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      const item = await research.ingest(cycle.id, source.id, { sourceUrl: `https://${index ? 'example.org' : 'example.com'}/problem/${index}`, title: `Observed issue ${index}`,
        content: `Customer ${index} reports spending hours reconciling appointment schedules manually.` });
      itemIds.push(item.id);
      aiMock.classifyResearch.mockResolvedValueOnce({ relevant: true, topic: 'Scheduling', summary: 'Manual scheduling work', confidence: 0.8,
        signals: [{ problem: 'Manual appointment reconciliation', category: 'Scheduling', evidenceQuote: 'spending hours reconciling appointment schedules manually.', confidence: 0.8 }] });
      await research.process(item.id); await research.cluster(item.id);
    }
    const duplicate = await research.ingest(cycle.id, source.id, { sourceUrl: 'https://example.net/repost', title: 'Repost',
      content: 'Customer 0 reports spending hours reconciling appointment schedules manually.' });
    expect(duplicate.status).toBe('DUPLICATE'); expect(duplicate.duplicateOfId).toBe(itemIds[0]);
    const summary = await research.dailySummary();
    expect(JSON.stringify(summary)).not.toMatch(/opportunities|recommendations|rankings/);
    expect(aiMock.extractStructuredData).not.toHaveBeenCalled();
    aiMock.extractStructuredData.mockResolvedValue({ opportunities: [{ name: 'Scheduling validation candidate', problem: 'Manual schedule reconciliation', targetCustomer: 'Small appointment businesses',
      evidence: ['Repeated manual reconciliation reports'], importance: 'Time spent on administration', demandSignals: ['Repeated reports'], competitors: ['Unknown; validate'],
      observedGap: 'Hypothesis: simpler reconciliation', proposedSolution: 'Schedule reconciliation assistant', mvp: 'CSV import and discrepancy report', businessModel: 'Subscription hypothesis',
      monetization: ['Validate willingness to pay'], technicalComplexity: 'Moderate', mvpComplexity: 'Small prototype', risks: ['Unproven willingness to pay'], distribution: ['Interview business operators'],
      researchRationale: 'Repeated traceable complaints', sourceReferences: itemIds.slice(0, 2), confidence: 0.6,
      dimensions: { demandEvidence: 0.5, problemSeverity: 0.5, frequency: 0.5, competitiveGap: 0.2, willingnessToPay: 0.1, marketDirection: 0.3, monetizationPotential: 0.3, technicalFeasibility: 0.8, distributionFeasibility: 0.4, evidenceQuality: 0.6 },
      validationExperiments: ['Interview 10 operators'] }], insufficiencyReason: 'Only one opportunity is supported by this fixture dataset.' });
    await research.finalize(cycle.id, true); await research.monthly(cycle.id);
    const report = await db.monthlyReport.findUniqueOrThrow({ where: { cycleId: cycle.id }, include: { opportunities: true } });
    expect(report.opportunities).toHaveLength(1); expect(report.insufficiencyReason).toContain('one opportunity');
    expect((await db.researchCycle.findUniqueOrThrow({ where: { id: cycle.id } })).status).toBe('COMPLETED');
    await research.monthly(cycle.id); expect(aiMock.extractStructuredData).toHaveBeenCalledTimes(1);
    expect(await db.researchItem.count({ where: { cycleId: cycle.id } })).toBe(4);
  });
  it('disallows early-finalization simulation in production', async () => {
    const production = new Settings(new ConfigService({ NODE_ENV: 'production' }));
    const research = new ResearchService(db, production, queues, ai, telegram, {} as UsageService);
    await expect(research.finalize('any', true)).rejects.toThrow('disabled in production');
  });
  it('runs Tavily client discovery through qualification, drafts and the client Telegram route', async () => {
    const config = new Settings(new ConfigService(validateEnvironment({ DATABASE_URL: process.env.DATABASE_URL, ADMIN_API_KEY: 'a'.repeat(32),
      TAVILY_ENABLED: 'true', TAVILY_API_KEY: 'mock-only', CLIENT_REGIONS: 'Delhi', CLIENT_CATEGORIES: 'Bakeries',
      CLIENT_DISCOVERY_QUERIES: '1', OPENAI_MODEL_SMALL: 'fixture' })));
    const date = new Date().toISOString().slice(0, 10), profile = 'https://instagram.com/tavily_fixture';
    const q = (text: string) => ({ sourceUrl: profile, text });
    const business = { businessName: 'Tavily Fixture Bakery', category: 'Bakeries', location: 'Delhi', profileUrl: profile,
      identity: q('Tavily Fixture Bakery in Delhi'), offering: q('We sell handmade cakes.'), activity: q(`Taking new cake orders ${date}`),
      activityDate: date, noWebsite: q('We have no website. Please contact us here.') };
    const tavily = { search: jest.fn().mockResolvedValue({ results: [{ url: profile, title: business.businessName,
      content: [business.identity.text, business.offering.text, business.activity.text, business.noWebsite.text].join('\n') }] }) } as unknown as TavilyService;
    const discoveryAI = { extractStructuredData: jest.fn().mockResolvedValueOnce({ businesses: [business] }).mockResolvedValue({ websiteUrl: null, evidence: null }),
      generatePitch: jest.fn().mockResolvedValue({ message: 'Would a dedicated cake-order website help your bakery?', supportingEvidence: [] }) } as unknown as AIService;
    const source = new TavilyBusinessSource(tavily, discoveryAI, config, db);
    const client = new ClientService(db, config, queues, discoveryAI, telegram, source);
    // Finish the remaining operator fixture so this discovery result is evaluated independently.
    await db.businessLead.updateMany({ where: { businessName: { startsWith: 'Fixture Bakery' } }, data: { status: 'REJECTED' } });
    await client.discover('2026-10-01');
    const batch = await db.clientBatch.findUniqueOrThrow({ where: { date: '2026-10-01' } });
    await client.audit(batch.id); await client.analyze(batch.id); await client.draftAndReport(batch.id);
    const lead = await db.businessLead.findFirstOrThrow({ where: { instagramUrl: profile }, include: { drafts: true, sources: true } });
    expect(lead.status).toBe('PRESENTED'); expect(lead.websiteStatus).toBe('NO_WEBSITE'); expect(lead.drafts).toHaveLength(1);
    expect(lead.sources[0].provider).toBe('tavily'); expect(lead.sources[0].evidence).toHaveProperty('discovery.query');
    expect(telegramMock.notify).toHaveBeenLastCalledWith(expect.any(String), expect.stringContaining('Tavily Fixture Bakery'), 'CLIENT');
    await client.discover('2026-10-01'); expect(tavily.search).toHaveBeenCalledTimes(2);
    const duplicate = await client.ingest({ businessName: business.businessName, category: 'Bakeries', location: 'Delhi',
      instagramUrl: 'https://instagram.com/alternate_fixture_profile', websiteUrl: null, sourceUrl: profile, verifiedAt: new Date().toISOString(),
      facts: [{ claim: business.identity.text, sourceUrl: profile }], factors: { noWebsite: true, poorWebsite: false, activeSocial: true,
        clearOffering: true, recentActivity: true, operatingEvidence: true, weakContact: false, serviceFit: true } });
    expect(duplicate.id).toBe(lead.id); expect(duplicate.status).toBe('PRESENTED');
    const websiteCandidate = { businessName: 'Website fixture', category: 'bakeries', location: 'delhi', websiteUrl: 'https://www.example.net/about',
      instagramUrl: 'https://instagram.com/website_fixture', sourceUrl: 'https://example.net', verifiedAt: new Date().toISOString(),
      facts: [{ claim: 'Website fixture in Delhi sells cakes.', sourceUrl: 'https://example.net' }],
      factors: { noWebsite: false, poorWebsite: false, activeSocial: true, clearOffering: true, recentActivity: true, operatingEvidence: true, weakContact: false, serviceFit: true } };
    const websiteLead = await client.ingest(websiteCandidate);
    const alias = await client.ingest({ ...websiteCandidate, businessName: 'Website fixture alias', instagramUrl: 'https://instagram.com/website_fixture_alias', websiteUrl: 'https://example.net/contact' });
    expect(alias.id).toBe(websiteLead.id); expect(alias.location).toBe('Delhi'); expect(alias.category).toBe('Bakeries');
  });
  it('collects Tavily research with provenance, processes it and completes a one-day development cycle', async () => {
    const config = new Settings(new ConfigService(validateEnvironment({ DATABASE_URL: process.env.DATABASE_URL, ADMIN_API_KEY: 'a'.repeat(32),
      RESEARCH_CYCLE_DAYS: '1', TAVILY_ENABLED: 'true', TAVILY_API_KEY: 'mock-only', RESEARCH_TAVILY_EXTRACTS: '0', NODE_ENV: 'test' })));
    const api = { enabled: () => true, search: jest.fn().mockResolvedValue({ results: [
      { url: 'https://example.com/tavily-evidence', title: 'Manual scheduling', content: 'Operators complain about losing hours reconciling spreadsheets manually.' },
      { url: 'https://example.com/tavily-evidence?utm_source=duplicate', title: 'Manual scheduling', content: 'Operators complain about losing hours reconciling spreadsheets manually.' },
    ] }), activity: jest.fn().mockResolvedValue({ searches: 1, extracts: 0, failed: 0, reservedCredits: 1, queries: ['small business complaints'] }) };
    const usage = { summary: jest.fn().mockResolvedValue({ daily: 0, monthly: 0 }) } as unknown as UsageService;
    const research = new ResearchService(db, config, queues, ai, telegram, usage, api as unknown as TavilyService);
    const source = await research.addSource({ name: 'Tavily e2e evidence', adapter: 'tavily', configuration: { topics: ['small business'], lenses: ['complaints'] } });
    const cycle = await research.startCycle(); expect(cycle.endDate.getTime() - cycle.startDate.getTime()).toBe(86400000);
    await research.collect(cycle.id, source.id, 1);
    const items = await db.researchItem.findMany({ where: { cycleId: cycle.id } }); expect(items).toHaveLength(1);
    expect(items[0].metadata).toMatchObject({ provider: 'tavily', query: 'small business complaints' });
    aiMock.classifyResearch.mockResolvedValueOnce({ relevant: true, topic: 'Scheduling', summary: 'Manual spreadsheet reconciliation', confidence: 0.8,
      signals: [{ problem: 'Manual reconciliation', category: 'Scheduling', evidenceQuote: 'losing hours reconciling spreadsheets manually.', confidence: 0.8 }] });
    await research.process(items[0].id); await research.cluster(items[0].id);
    await research.collect(cycle.id, source.id, 1); expect(await db.researchItem.count({ where: { cycleId: cycle.id } })).toBe(1);
    const summary = await research.dailySummary(); expect(summary).toHaveProperty('tavily.searches', 1);
    expect(JSON.stringify(summary)).not.toMatch(/opportunities|recommendations/);
    await research.finalize(cycle.id, true); await research.monthly(cycle.id);
    const report = await db.monthlyReport.findUniqueOrThrow({ where: { cycleId: cycle.id } });
    expect(report.insufficiencyReason).toContain('Insufficient traceable evidence');
    expect((await db.researchCycle.findUniqueOrThrow({ where: { id: cycle.id } })).status).toBe('COMPLETED');
  });
});
