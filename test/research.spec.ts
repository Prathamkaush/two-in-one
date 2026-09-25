import { canonicalUrl, contentHash, normalizeContent } from '../src/research-agent/normalization';
describe('research normalization and deduplication', () => {
  it('normalizes markup and whitespace', () => expect(normalizeContent('<script>evil()</script><p>A  problem</p>')).toBe('A problem'));
  it('removes tracking without collapsing distinct query resources', () => {
    expect(canonicalUrl('https://example.com/a?utm_source=x&id=1#top')).toBe('https://example.com/a?id=1');
    expect(canonicalUrl('https://example.com/a?id=2')).not.toBe(canonicalUrl('https://example.com/a?id=1'));
  });
  it('deduplicates equivalent text but not different evidence', () => {
    expect(contentHash('<p>A problem</p>')).toBe(contentHash('a   problem'));
    expect(contentHash('Different problem')).not.toBe(contentHash('A problem'));
  });
});
