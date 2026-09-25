import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { PrismaService } from '../src/database/prisma.service';
import { AIService } from '../src/ai/ai.service';
import { TavilyService } from '../src/tavily/tavily.service';
import { clientQueries, confirmedNoWebsite, normalizedProfile, TavilyBusinessSource } from '../src/client-agent/discovery/tavily.source';

describe('Tavily client discovery', () => {
  const profile = 'https://www.instagram.com/fixture_bakery/';
  const date = new Date().toISOString().slice(0, 10);
  const quote = (text: string) => ({ text, sourceUrl: profile });
  const business = { businessName: 'Fixture Bakery', location: 'Delhi', category: 'Bakeries', profileUrl: profile,
    identity: quote('Fixture Bakery in Delhi'), offering: quote('We bake cakes for local customers.'),
    activity: quote(`Taking cake orders ${date}`), activityDate: date, noWebsite: quote('We have no website. Contact us on Instagram.') };
  const result = { url: profile, title: 'Fixture Bakery', content: [business.identity.text, business.offering.text, business.activity.text, business.noWebsite.text].join('\n') };
  const input = { date, regions: ['Delhi'], categories: ['Bakeries'] };
  function setup(candidate = business) {
    const api = { search: jest.fn().mockResolvedValue({ results: [result] }) };
    const ai = { extractStructuredData: jest.fn().mockResolvedValueOnce({ businesses: [candidate] }).mockResolvedValue({ websiteUrl: null, evidence: null }) };
    const db = { businessLead: { findFirst: jest.fn().mockResolvedValue(null) } };
    const settings = new Settings(new ConfigService({ CLIENT_DISCOVERY_QUERIES: 1, CLIENT_DISCOVERY_CANDIDATES: 3 }));
    return { api, ai, db, adapter: new TavilyBusinessSource(api as unknown as TavilyService, ai as unknown as AIService, settings, db as unknown as PrismaService) };
  }
  it('normalizes a real observed profile and qualifies explicit first-party no-website evidence', async () => {
    const { adapter } = setup(); const output = await adapter.discover(input);
    expect(output.businesses[0].candidate).toMatchObject({ instagramUrl: 'https://instagram.com/fixture_bakery', websiteUrl: null,
      factors: { noWebsite: true, operatingEvidence: true, activeSocial: true } });
    expect(output.businesses[0].provenance).toMatchObject({ provider: 'tavily', query: expect.stringContaining('Delhi'), verificationQuery: expect.stringContaining('official website') });
    expect(normalizedProfile('https://www.instagram.com/Foo/?utm_source=x')).toBe('https://instagram.com/foo');
  });
  it('keeps missing website evidence unknown, even after an empty verification search', async () => {
    const { adapter, ai, api } = setup();
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [{ ...business, noWebsite: null }] }).mockResolvedValue({ websiteUrl: null, evidence: null });
    api.search.mockResolvedValueOnce({ results: [result] }).mockResolvedValue({ results: [] });
    const output = await adapter.discover(input);
    expect(output.businesses[0].candidate.factors.noWebsite).toBe(false); expect(output.uncertainWebsites).toBe(1);
  });
  it('preserves a verified website and overrides a contradictory no-website claim', async () => {
    const { adapter, api, ai } = setup();
    const website = { url: 'https://example.com', title: 'Fixture Bakery Delhi', content: 'Fixture Bakery Delhi official cake shop website.' };
    api.search.mockResolvedValueOnce({ results: [result] }).mockResolvedValue({ results: [website] });
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [business] }).mockResolvedValue({ websiteUrl: website.url, evidence: { sourceUrl: website.url, text: website.content } });
    const output = await adapter.discover(input);
    expect(output.businesses[0].candidate.websiteUrl).toBe(website.url); expect(output.businesses[0].candidate.factors.noWebsite).toBe(false);
    expect(output.businesses[0].candidate.factors.poorWebsite).toBe(false);
  });
  it('does not spend verification credits on an existing business', async () => {
    const { adapter, db, api } = setup(); db.businessLead.findFirst.mockResolvedValue({ id: 'already-contacted' });
    expect((await adapter.discover(input)).duplicates).toBe(1); expect(api.search).toHaveBeenCalledTimes(1);
  });
  it.each([{ location: 'Mumbai' }, { category: 'Software vendors' }, { profileUrl: 'https://instagram.com/invented' },
    { identity: { sourceUrl: profile, text: 'Invented business in Delhi' } }])('rejects mismatched or unsupported candidates %p', async (override) => {
    const { adapter } = setup({ ...business, ...override }); expect((await adapter.discover(input)).businesses).toHaveLength(0);
  });
  it('does not treat stale activity or third-party speculation as verified', async () => {
    const { adapter } = setup({ ...business, activityDate: '2020-01-01' });
    expect((await adapter.discover(input)).businesses[0].candidate.factors.activeSocial).toBe(false);
    expect(confirmedNoWebsite({ sourceUrl: 'https://example.com/list', text: 'We have no website.' }, profile,
      [{ url: 'https://example.com/list', title: 'Listing', content: 'We have no website.' }])).toBe(false);
    expect(confirmedNoWebsite({ sourceUrl: profile, text: 'We have no website issues.' }, profile,
      [{ url: profile, title: 'Listing', content: 'We have no website issues.' }])).toBe(false);
  });
  it('isolates provider failure and rotates query combinations across days', async () => {
    const { adapter, api } = setup(); api.search.mockRejectedValue(new Error('provider failure'));
    expect(await adapter.discover(input)).toMatchObject({ businesses: [], errors: 1 });
    const regions = ['Delhi', 'Noida'], categories = ['Bakeries', 'Salons'];
    expect(clientQueries('2026-09-25', regions, categories, 1)).not.toEqual(clientQueries('2026-09-26', regions, categories, 1));
  });
});
