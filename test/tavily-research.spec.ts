import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { TavilyService } from '../src/tavily/tavily.service';
import { relevantSnippet, researchQueries, tavilyResearchConfig, TavilyResearchSource } from '../src/research-agent/sources/tavily.source';
describe('Tavily research adapter', () => {
  const settings = new Settings(new ConfigService({ RESEARCH_TAVILY_QUERIES: 1, RESEARCH_TAVILY_EXTRACTS: 1 }));
  const snippet = { url: 'https://example.com/problem', title: 'Manual scheduling problems', content: 'Customers complain about manual scheduling every week.' };
  function setup() {
    const api = { search: jest.fn().mockResolvedValue({ results: [snippet], request_id: 'request-1' }),
      extract: jest.fn().mockResolvedValue({ results: [{ url: snippet.url, raw_content: 'Customers struggle with manual scheduling and repeatedly lose appointments.' }] }) };
    return { api, adapter: new TavilyResearchSource(api as unknown as TavilyService, settings, { key: 'batch', slot: 0, configuration: {} }) };
  }
  const input = { since: new Date('2026-01-01'), limit: 5 };
  it('maps evidence with provenance and selectively extracts short relevant snippets', async () => {
    const { adapter, api } = setup(); const items = await adapter.collect(input);
    expect(items[0]).toMatchObject({ sourceUrl: snippet.url, title: snippet.title,
      metadata: { provider: 'tavily', snippet: snippet.content, requestId: 'request-1', domain: 'example.com' } });
    expect(items[0].metadata.query).toContain('customer complaints');
    expect(items[0].content).toContain('lose appointments'); expect(api.extract).toHaveBeenCalledTimes(1);
    expect(items[0].publishedAt).toBeUndefined();
  });
  it('deduplicates URLs and skips known pages before extraction', async () => {
    const { api, adapter } = setup(); api.search.mockResolvedValue({ results: [snippet, { ...snippet, url: `${snippet.url}?utm_source=test` }] });
    expect(await adapter.collect(input)).toHaveLength(1); expect(api.extract).toHaveBeenCalledTimes(1);
    const known = new TavilyResearchSource(api as unknown as TavilyService, settings, { key: 'next', slot: 1, configuration: {}, knownUrls: new Set([snippet.url]) });
    expect(await known.collect(input)).toHaveLength(0); expect(api.extract).toHaveBeenCalledTimes(1);
  });
  it('filters idea lists and avoids extraction when snippets are already sufficient', async () => {
    const { api, adapter } = setup();
    api.search.mockResolvedValue({ results: [{ ...snippet, title: 'Top 10 startup ideas' }, { ...snippet, content: snippet.content.repeat(20) }] });
    expect(await adapter.collect(input)).toHaveLength(1); expect(api.extract).not.toHaveBeenCalled();
    expect(relevantSnippet('Weather', 'Sunny tomorrow')).toBe(false);
  });
  it('handles empty search and extraction failure with an honest snippet fallback', async () => {
    const { api, adapter } = setup(); api.search.mockResolvedValueOnce({ results: [] });
    expect(await adapter.collect(input)).toEqual([]);
    api.extract.mockRejectedValue(new Error('provider failure'));
    const items = await adapter.collect(input);
    expect(items[0].content).toBe(snippet.content); expect(items[0].metadata.extractFailed).toBe(true);
  });
  it('reports search failure to the isolated source job', async () => {
    const { api, adapter } = setup(); api.search.mockRejectedValue(new Error('provider unavailable'));
    await expect(adapter.collect(input)).rejects.toThrow('other source jobs continue');
  });
  it('rotates configurable topics and lenses deterministically', () => {
    const config = tavilyResearchConfig.parse({ topics: ['Salons', 'Gyms'], lenses: ['manual work', 'complaints'] });
    expect(researchQueries(config, 0, 1)).toEqual(['Salons manual work']);
    expect(researchQueries(config, 1, 1)).toEqual(['Salons complaints']);
    expect(researchQueries(config, 4, 1)).toEqual(researchQueries(config, 0, 1));
  });
});
