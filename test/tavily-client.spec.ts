import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { PrismaService } from '../src/database/prisma.service';
import { AIService } from '../src/ai/ai.service';
import { TavilyService } from '../src/tavily/tavily.service';
import { clientQueries, confirmedNoWebsite, matchesMarketLocation, normalizedProfile, recentDateSupported, TavilyBusinessSource } from '../src/client-agent/discovery/tavily.source';

describe('Tavily client discovery', () => {
  const profile = 'https://www.instagram.com/fixture_bakery/';
  const date = new Date().toISOString().slice(0, 10);
  const quote = (text: string) => ({ text, sourceUrl: profile });
  const business = { businessName: 'Fixture Bakery', location: 'Delhi', category: 'Bakeries', profileUrl: profile,
    identity: quote('Fixture Bakery in Delhi'), offering: quote('We bake cakes for local customers.'),
    activity: quote(`Taking cake orders ${date}`), activityDate: date, noWebsite: quote('We have no website. Contact us on Instagram.') };
  const result = { url: profile, title: 'Fixture Bakery', content: [business.identity.text, business.offering.text, business.activity.text, business.noWebsite.text].join('\n') };
  const input = { date, regions: ['Delhi'], categories: ['Bakeries'] };
  function setup(candidate = business, extracts = 0) {
    const api = { search: jest.fn().mockResolvedValue({ results: [result] }), extract: jest.fn().mockResolvedValue({ results: [] }) };
    const ai = { extractStructuredData: jest.fn().mockResolvedValueOnce({ businesses: [candidate] }).mockResolvedValue({ websiteUrl: null, evidence: null }) };
    const db = { businessLead: { findFirst: jest.fn().mockResolvedValue(null) } };
    const settings = new Settings(new ConfigService({ CLIENT_DISCOVERY_QUERIES: 1, CLIENT_DISCOVERY_CANDIDATES: 3, CLIENT_ENRICHMENT_EXTRACTS: extracts }));
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
  it('recognizes a website in the exact profile bio without repeating name and city in the quote', async () => {
    const { adapter, api, ai } = setup();
    api.search.mockResolvedValue({ results: [{ ...result, content: `${result.content}\nShop online: fixturebakery.in` }] });
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [business] }).mockResolvedValue({
      websiteUrl: 'https://fixturebakery.in/', evidence: quote('Shop online: fixturebakery.in'),
    });
    const output = await adapter.discover(input);
    expect(output.businesses[0].candidate.websiteUrl).toBe('https://fixturebakery.in/');
    expect(output.businesses[0].candidate.factors.noWebsite).toBe(false);
  });
  it('withholds a candidate with an unresolved bio website even when AI misses it', async () => {
    const { adapter, api } = setup();
    api.search.mockResolvedValue({ results: [{ ...result, content: `${result.content}\nWebsite: https://fixturebakery.in/` }] });
    const output = await adapter.discover(input);
    expect(output.businesses).toHaveLength(0);
    expect(output.rejections.external_profile_link_requires_verification).toBe(1);
  });
  it('does not associate another business profile link with this business', async () => {
    const { adapter, api } = setup();
    api.search.mockResolvedValue({ results: [result, { url: 'https://instagram.com/other', title: 'Other', content: 'Website: https://other.in/' }] });
    expect((await adapter.discover(input)).businesses[0].candidate.websiteUrl).toBeNull();
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
  it('accepts observed title evidence, URL variants and Delhi, India while retaining uncertainty', async () => {
    const p = 'https://www.instagram.com/harunstudios?hl=en';
    const source = { url: p, title: 'Delhi | India (@harunstudios)',
      content: 'Harun | Videographer | Photographer | Delhi | India. Camera & iPhone filmmaking. Fashion | Beauty | Weddings' };
    const q = (text: string) => ({ sourceUrl: 'https://instagram.com/harunstudios/', text });
    const { adapter, ai, api } = setup();
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [{ ...business,
      businessName: 'Harun Studios', location: 'Delhi, India', profileUrl: 'https://instagram.com/harunstudios/',
      identity: q('"Delhi | India (@harunstudios)"'), offering: q('"Camera & iPhone filmmaking"'),
      activity: q('"Fashion | Beauty | Weddings"'), activityDate: '', noWebsite: null,
    }] }).mockResolvedValue({ websiteUrl: null, evidence: null });
    api.search.mockResolvedValue({ results: [source] });
    const output = await adapter.discover(input);
    expect(output.businesses).toHaveLength(1);
    expect(output.businesses[0].candidate).toMatchObject({ location: 'Delhi', factors: { noWebsite: false, recentActivity: false, activeSocial: false } });
    expect(output.businesses[0].candidate.facts[0].claim).toBe(source.title);
    expect(output).toMatchObject({ extractedCandidates: 1, rejections: {}, missingRecentActivity: 1, uncertainWebsites: 1 });
  });
  it('reports ambiguous NCR location and directory URLs without treating them as leads', async () => {
    const { adapter, ai } = setup();
    ai.extractStructuredData.mockReset().mockResolvedValue({ businesses: [
      { ...business, location: 'Delhi NCR' },
      { ...business, profileUrl: 'https://example.com/directory/bakery' },
    ] });
    const output = await adapter.discover(input);
    expect(output.businesses).toHaveLength(0);
    expect(output.rejections).toEqual({ location_mismatch_or_ambiguous: 1, not_a_social_profile: 1 });
  });
  it('does not ground a quote against a different page selected by a query parameter', async () => {
    const { adapter, ai, api } = setup();
    ai.extractStructuredData.mockReset().mockResolvedValue({ businesses: [{ ...business,
      identity: { ...business.identity, sourceUrl: 'https://example.com/business?id=other' } }] });
    api.search.mockResolvedValue({ results: [result, { ...result, url: 'https://example.com/business?id=fixture' }] });
    expect((await adapter.discover(input)).rejections).toEqual({ unsupported_identity_or_offering_quote: 1 });
  });
  it.each(['418, Rohini, Delhi', 'Hari Nagar, Delhi 110064', 'New Delhi India', 'Delhi (Pitampura / Shalimar Bagh / Prashant Vihar)'])('matches explicit Delhi addresses: %s', (address) => {
    expect(matchesMarketLocation(address, 'Delhi', ['Delhi', 'Noida', 'Gurugram'])).toBe(true);
  });
  it.each(['Delhi NCR', 'Noida, Delhi NCR', 'Near Delhi', 'Delhi / Noida', 'Rohini', 'Mumbai'])('does not infer Delhi from ambiguous/outside labels: %s', (address) => {
    expect(matchesMarketLocation(address, 'Delhi', ['Delhi', 'Noida', 'Gurugram'])).toBe(false);
  });
  it('does not merge Greater Noida with Noida', () => {
    expect(matchesMarketLocation('Greater Noida, India', 'Noida', ['Noida'])).toBe(false);
  });
  it('resolves a reel to a returned profile with corroborating name/location without claiming recent activity', async () => {
    const reel = 'https://instagram.com/reel/ObservedID';
    const { adapter, api, ai } = setup();
    const q = (text: string) => ({ text, sourceUrl: reel });
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [{ ...business, profileUrl: reel,
      location: 'Hari Nagar, Delhi 110064', identity: q('Fixture Bakery in Delhi'), offering: q('We bake cakes for local customers.'),
      activity: q(`Taking cake orders ${date}`), noWebsite: null,
    }] }).mockResolvedValue({ websiteUrl: null, evidence: null });
    api.search.mockResolvedValueOnce({ results: [{ ...result, url: reel }] }).mockResolvedValueOnce({ results: [result] }).mockResolvedValue({ results: [] });
    const output = await adapter.discover(input);
    expect(output.businesses).toHaveLength(1);
    expect(output.businesses[0].candidate.instagramUrl).toBe('https://instagram.com/fixture_bakery');
    expect(output.businesses[0].candidate.factors.activeSocial).toBe(false);
    expect(output.queries).toHaveLength(3);
    expect(api.search).toHaveBeenCalledTimes(3);
  });
  it('does not invent a profile URL when reel resolution returns no profile', async () => {
    const reel = 'https://instagram.com/reel/ObservedID';
    const { adapter, api, ai } = setup();
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [{ ...business, profileUrl: reel,
      identity: { ...business.identity, sourceUrl: reel }, offering: { ...business.offering, sourceUrl: reel },
    }] });
    api.search.mockResolvedValueOnce({ results: [{ ...result, url: reel }] }).mockResolvedValueOnce({ results: [] });
    const output = await adapter.discover(input);
    expect(output.businesses).toHaveLength(0);
    expect(output.rejections).toEqual({ profile_resolution_unconfirmed: 1 });
    expect(api.search).toHaveBeenCalledTimes(2);
  });
  it('accepts a truncated offering only when the retained quote occurs verbatim', async () => {
    const { adapter } = setup({ ...business, location: '418, Rohini, Delhi', offering: { ...business.offering, text: 'We bake cakes for local customers. …' } });
    const result = await adapter.discover(input);
    expect(result.businesses).toHaveLength(1);
    expect(result.businesses[0].candidate.facts[1].claim).toBe('We bake cakes for local customers.');
  });
  it('targets website verification with the observed handle, category and locality', async () => {
    const { adapter, api } = setup({ ...business, location: '418, Rohini, Delhi' });
    await adapter.discover(input);
    expect(api.search.mock.calls[1][0]).toContain('"fixture_bakery" Bakeries 418, Rohini, Delhi');
  });
  it('retains an unknown candidate when verification or AI enrichment fails', async () => {
    const { adapter, api, ai } = setup();
    api.search.mockResolvedValueOnce({ results: [result] }).mockRejectedValue(new Error('budget exhausted'));
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [business] }).mockRejectedValue(new Error('AI budget exhausted'));
    const output = await adapter.discover(input);
    expect(output.businesses).toHaveLength(1);
    expect(output.businesses[0].candidate.factors.noWebsite).toBe(false);
    expect(output.enrichmentFailures).toBe(2);
  });
  it('selectively extracts a profile, validates its dated quote, and does not assume absence from missing links', async () => {
    const { adapter, api, ai } = setup(business, 1);
    const activity = `Taking orders on ${date}`;
    api.extract.mockResolvedValue({ results: [{ url: profile, raw_content: `Fixture Bakery in Delhi. ${activity}` }] });
    ai.extractStructuredData.mockReset().mockResolvedValueOnce({ businesses: [{ ...business, activityDate: '', noWebsite: null }] }).mockResolvedValue({
      websiteUrl: null, evidence: null, activityDate: date, activity: quote(activity), noWebsite: null,
    });
    const output = await adapter.discover(input);
    expect(api.extract).toHaveBeenCalledTimes(1);
    expect(output.businesses[0].candidate.factors).toMatchObject({ activeSocial: true, noWebsite: false });
  });
  it('recognizes actual calendar dates, rejects invented/future/stale dates', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    expect(recentDateSupported('2026-09-25', 'Orders opened September 25, 2026', now)).toBe(true);
    expect(recentDateSupported('2026-09-25', 'Orders opened 25 September 2026', now)).toBe(true);
    expect(recentDateSupported('2026-09-25', 'DM for orders', now)).toBe(false);
    expect(recentDateSupported('2026-09-27', '2026-09-27', now)).toBe(false);
    expect(recentDateSupported('2020-09-25', '2020-09-25', now)).toBe(false);
  });
});
