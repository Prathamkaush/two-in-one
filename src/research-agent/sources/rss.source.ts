import Parser from 'rss-parser';
import { getPublicPage } from '../../common/security/public-http';
import { ResearchSourceAdapter } from './research-source';
export class RssSource implements ResearchSourceAdapter {
  readonly name = 'rss';
  constructor(private readonly url: string) {}
  async collect(input: { since: Date; limit: number }) {
    const response = await getPublicPage(this.url);
    if (response.status !== 200) throw new Error(`RSS HTTP ${response.status}`);
    const parsed = await new Parser().parseString(response.content);
    return parsed.items.filter((item) => item.link && item.title)
      .map((item) => ({ sourceUrl: item.link!, title: item.title!, content: item.contentSnippet ?? item.content ?? item.summary ?? '',
        publishedAt: item.isoDate && !Number.isNaN(Date.parse(item.isoDate)) ? new Date(item.isoDate) : undefined, metadata: { feedUrl: this.url } }))
      .filter((item) => !item.publishedAt || item.publishedAt >= input.since).slice(0, input.limit);
  }
}
