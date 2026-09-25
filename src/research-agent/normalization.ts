import { createHash } from 'node:crypto';
export function normalizeContent(content: string) {
  return content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').normalize('NFKC').replace(/\s+/g, ' ').trim();
}
export function canonicalUrl(value: string) {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.toString();
}
export function contentHash(content: string) { return createHash('sha256').update(normalizeContent(content).toLowerCase()).digest('hex'); }
export function clusterKey(category: string, problem: string) {
  return contentHash(`${category.trim().toLowerCase()}:${problem.trim().toLowerCase()}`);
}
