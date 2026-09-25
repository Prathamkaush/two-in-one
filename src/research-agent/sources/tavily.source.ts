import { z } from 'zod';
import { Settings } from '../../common/config/settings.service';
import { publicUrl } from '../../common/security/public-http';
import { TavilyService } from '../../tavily/tavily.service';
import { canonicalUrl } from '../normalization';
import { ResearchEvidence, ResearchSourceAdapter } from './research-source';

export const tavilyResearchConfig = z.object({
  topics: z.array(z.string().trim().min(2).max(150)).min(1).max(100).default(['small businesses India', 'local service businesses', 'independent professionals', 'retail operations']),
  lenses: z.array(z.string().trim().min(2).max(150)).min(1).max(100).default([
    'customer complaints', 'manual processes spreadsheets', 'software too expensive', 'repetitive administrative work',
    'underserved customers', 'product dissatisfaction', 'changing customer demand', 'technology adoption challenges',
  ]),
}).strict();
export function researchQueries(config: z.infer<typeof tavilyResearchConfig>, slot: number, count: number) {
  const pairs = config.topics.flatMap((topic) => config.lenses.map((lens) => `${topic} ${lens}`));
  return Array.from({ length: Math.min(count, pairs.length) }, (_, i) => pairs[(slot * count + i) % pairs.length]);
}
export function relevantSnippet(title: string, content: string) {
  return !/\b(?:best|top|\d+)\s+(?:\d+\s+)?(?:startup|business) ideas\b/i.test(title) &&
    /complain|frustrat|manual|spreadsheet|expensive|inefficien|struggl|underserv|problem|dissatisf|repetitive|demand|adoption|challenge|cost|gap|workflow/i.test(`${title} ${content}`);
}
export class TavilyResearchSource implements ResearchSourceAdapter {
  readonly name = 'tavily';
  constructor(private readonly tavily: TavilyService, private readonly settings: Settings,
    private readonly context: { key: string; slot: number; configuration: unknown; knownUrls?: Set<string> }) {}
  async collect(input: { since: Date; limit: number }): Promise<ResearchEvidence[]> {
    const config = tavilyResearchConfig.parse(this.context.configuration);
    const items: ResearchEvidence[] = [], seen = new Set<string>();
    let extracts = 0, failures = 0, successes = 0;
    for (const query of researchQueries(config, this.context.slot, this.settings.get('RESEARCH_TAVILY_QUERIES'))) {
      try {
        const response = await this.tavily.search(query, { agent: 'RESEARCH', key: `${this.context.key}-${query}` });
        successes++;
        for (const result of response.results) {
          if (items.length >= input.limit) break;
          try { publicUrl(result.url); } catch { continue; }
          const canonical = canonicalUrl(result.url);
          if (seen.has(canonical) || this.context.knownUrls?.has(canonical) || !relevantSnippet(result.title, result.content)) continue;
          seen.add(canonical);
          let content = result.content.slice(0, 16000), extracted = '', extractFailed = false;
          if (content.length < 800 && extracts < this.settings.get('RESEARCH_TAVILY_EXTRACTS')) {
            extracts++;
            try {
              const extraction = await this.tavily.extract(result.url, { agent: 'RESEARCH', key: `${this.context.key}-extract-${canonical}` });
              const page = extraction.results.find((r) => canonicalUrl(r.url) === canonical);
              if (page?.raw_content) { extracted = page.raw_content.slice(0, 16000); content = extracted; }
              else extractFailed = true;
            } catch { extractFailed = true; }
          }
          if (content.trim().length < 20) continue;
          const publication = result.published_date ? new Date(result.published_date) : undefined;
          const publishedAt = publication && Number.isFinite(publication.getTime()) && publication <= new Date() ? publication : undefined;
          items.push({ sourceUrl: result.url, title: result.title.slice(0, 500), content, publishedAt,
            metadata: { provider: 'tavily', query, snippet: result.content.slice(0, 8000), extractedContent: extracted,
              collectedAt: new Date().toISOString(), domain: new URL(result.url).hostname,
              publicationTimestamp: publishedAt?.toISOString() ?? '', extractFailed,
              requestId: response.request_id ?? '', collectionWindowStart: input.since.toISOString() } });
        }
      } catch { failures++; }
    }
    if (failures && !successes) throw new Error('Tavily research searches failed; other source jobs continue');
    return items;
  }
}
