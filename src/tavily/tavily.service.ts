import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Agent, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Settings } from '../common/config/settings.service';
import { PrismaService } from '../database/prisma.service';
import { publicUrl } from '../common/security/public-http';

const usage = z.object({ credits: z.number().finite().nonnegative() }).optional();
export const searchSchema = z.object({
  results: z.array(z.object({ url: z.string().url().max(2048), title: z.string().max(2000),
    content: z.string().max(100000), score: z.number().optional(), published_date: z.string().nullish() })).max(20),
  usage, request_id: z.string().optional(),
});
const extractSchema = z.object({
  results: z.array(z.object({ url: z.string().url(), raw_content: z.string().max(500000) })).max(1),
  failed_results: z.array(z.unknown()).optional(), usage,
});
export type SearchResult = z.infer<typeof searchSchema>['results'][number];
export interface TavilyContext { agent: Agent; key: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TavilyService {
  private readonly logger = new Logger(TavilyService.name);
  constructor(private readonly settings: Settings, private readonly db: PrismaService) {}
  enabled() { return this.settings.get('TAVILY_ENABLED'); }
  search(query: string, context: TavilyContext) {
    if (!query.trim() || query.length > 500) throw new Error('Invalid Tavily query');
    return this.request('search', { query, search_depth: 'basic', topic: 'general', auto_parameters: false,
      max_results: this.settings.get('TAVILY_MAX_RESULTS_PER_QUERY'), include_answer: false,
      include_raw_content: false, include_images: false, include_usage: true }, query, context, searchSchema);
  }
  extract(url: string, context: TavilyContext) {
    publicUrl(url);
    return this.request('extract', { urls: [url], extract_depth: 'basic', format: 'text', include_usage: true }, url, context, extractSchema);
  }
  async activity(agent?: Agent, since = new Date(Date.now() - 86400000)) {
    const rows = await this.db.tavilyRequest.findMany({ where: { ...(agent ? { agent } : {}), createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } });
    return { attempts: rows.length, searches: rows.filter((r) => r.operation === 'search').length,
      extracts: rows.filter((r) => r.operation === 'extract').length,
      failed: rows.filter((r) => ['FAILED', 'RETRYABLE'].includes(r.status)).length,
      unresolved: rows.filter((r) => r.status === 'RESERVED').length,
      reservedCredits: rows.reduce((n, r) => n + r.reservedCredits, 0),
      reportedCredits: rows.reduce((n, r) => n + (r.reportedCredits ?? 0), 0),
      queries: [...new Set(rows.filter((r) => r.operation === 'search').map((r) => r.query))],
      requestDurationMs: rows.reduce((n, r) => n + (r.finishedAt ? r.finishedAt.getTime() - r.createdAt.getTime() : 0), 0),
      startedAt: rows[0]?.createdAt.toISOString() ?? null,
      finishedAt: rows.at(-1)?.finishedAt?.toISOString() ?? null };
  }
  private async reserve(requestKey: string, context: TavilyContext, operation: string, query: string, attempt: number) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71829343)::text`;
      const existing = await tx.tavilyRequest.findUnique({ where: { requestKey } });
      if (existing) return { row: existing, owned: false };
      const now = new Date(), day = new Date(now.toISOString().slice(0, 10)), month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [daily, monthly, minute] = await Promise.all([
        tx.tavilyRequest.aggregate({ where: { createdAt: { gte: day } }, _sum: { reservedCredits: true } }),
        tx.tavilyRequest.aggregate({ where: { createdAt: { gte: month } }, _sum: { reservedCredits: true } }),
        tx.tavilyRequest.count({ where: { createdAt: { gte: new Date(now.getTime() - 60000) } } }),
      ]);
      if ((daily._sum.reservedCredits ?? 0) + 1 > this.settings.get('TAVILY_DAILY_CREDIT_LIMIT') ||
          (monthly._sum.reservedCredits ?? 0) + 1 > this.settings.get('TAVILY_MONTHLY_CREDIT_LIMIT')) throw new ServiceUnavailableException('Tavily credit limit reached');
      if (minute >= this.settings.get('TAVILY_REQUESTS_PER_MINUTE')) throw new ServiceUnavailableException('Tavily local rate limit reached');
      return { row: await tx.tavilyRequest.create({ data: { requestKey, agent: context.agent, operation, query, attempt } }), owned: true };
    }, { maxWait: 15000, timeout: 15000 });
  }
  private async request<T extends z.ZodTypeAny>(operation: string, body: object, query: string, context: TavilyContext, schema: T): Promise<z.infer<T>> {
    if (!this.enabled()) throw new ServiceUnavailableException('Tavily is disabled');
    const maxRetries = this.settings.get('TAVILY_MAX_RETRIES');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const requestKey = digest(JSON.stringify([context, operation, body, attempt]));
      const { row, owned } = await this.reserve(requestKey, context, operation, query, attempt);
      if (row.status === 'COMPLETED') return schema.parse(row.result);
      if (!owned) {
        if (row.status === 'RETRYABLE' && attempt < maxRetries) {
          const delay = Math.max(0, (row.finishedAt?.getTime() ?? Date.now()) + row.retryAfterMs - Date.now());
          if (delay > 10000) throw new ServiceUnavailableException('Tavily retry deferred by provider');
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new ServiceUnavailableException(`Tavily request ${row.status.toLowerCase()}; inspect protected usage ledger`);
      }
      let code = 'NETWORK_OR_TIMEOUT', retryable = true, retryAfterMs = 500 * 2 ** attempt;
      try {
        const response = await fetch(`https://api.tavily.com/${operation}`, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${this.settings.get('TAVILY_API_KEY')}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(this.settings.get('TAVILY_REQUEST_TIMEOUT_MS')) });
        if (!response.ok) {
          code = `HTTP_${response.status}`;
          retryable = response.status === 429 || response.status >= 500;
          const header = response.headers.get('retry-after');
          if (header) {
            const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
            if (Number.isFinite(delay)) retryAfterMs = Math.max(retryAfterMs, Math.min(86400000, delay));
          }
          await response.body?.cancel();
          throw new Error(code);
        }
        code = 'MALFORMED_RESPONSE'; retryable = false;
        const reader = response.body?.getReader();
        if (!reader) throw new Error(code);
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength;
            if (size > 1000000) throw new Error(code);
            chunks.push(part.value);
          }
        } finally { await reader.cancel().catch(() => undefined); }
        const result = schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const credits = (result as { usage?: { credits: number } }).usage?.credits;
        await this.db.tavilyRequest.update({ where: { id: row.id }, data: { status: 'COMPLETED',
          result: result as Prisma.InputJsonValue, reportedCredits: credits, reservedCredits: Math.max(1, Math.ceil(credits ?? 1)), finishedAt: new Date() } });
        return result;
      } catch {
        await this.db.tavilyRequest.update({ where: { id: row.id }, data: { status: retryable ? 'RETRYABLE' : 'FAILED', errorCode: code, retryAfterMs, finishedAt: new Date() } });
        this.logger.warn(`Tavily ${operation} ${code}; attempt ${attempt + 1}`);
        if (!retryable || attempt === maxRetries || retryAfterMs > 10000) throw new ServiceUnavailableException(`Tavily ${code}; inspect protected usage ledger`);
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      }
    }
    throw new ServiceUnavailableException('Tavily retry limit reached');
  }
}
