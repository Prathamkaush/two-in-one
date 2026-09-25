import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { validateEnvironment } from '../src/common/config/environment';
import { PrismaService } from '../src/database/prisma.service';
import { TavilyService } from '../src/tavily/tavily.service';

const env = { DATABASE_URL: 'postgresql://u:p@localhost/test', ADMIN_API_KEY: 'a'.repeat(32), TAVILY_ENABLED: 'true', TAVILY_API_KEY: 'secret-fixture', TAVILY_MAX_RETRIES: '0' };
export function tavilySettings(overrides: Record<string, unknown> = {}) { return new Settings(new ConfigService(validateEnvironment({ ...env, ...overrides }))); }
describe('shared Tavily transport', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  function setup(overrides: Record<string, unknown> = {}) {
    const rows = new Map<string, Record<string, unknown>>();
    const table = { findUnique: jest.fn(async ({ where }: { where: { requestKey: string } }) => rows.get(where.requestKey) ?? null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { reservedCredits: 0 } }), count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: String(data.requestKey), status: 'RESERVED', reservedCredits: 1, createdAt: new Date(), ...data }; rows.set(String(data.requestKey), row); return row;
      }), update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(rows.get(where.id)!, data); return rows.get(where.id); }) };
    const tx = { tavilyRequest: table, $queryRaw: jest.fn() };
    const db = { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaService;
    return { service: new TavilyService(tavilySettings(overrides), db), table, rows };
  }
  beforeEach(() => { fetchMock = jest.fn(); global.fetch = fetchMock; });
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
  it('searches with basic depth, records credits and reuses the durable response', async () => {
    const { service, rows } = setup();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [{ url: 'https://example.com', title: 'Problem', content: 'Manual work' }], usage: { credits: 1 } })));
    const context = { agent: 'CLIENT' as const, key: 'same-job' };
    expect((await service.search('business problems', context)).results).toHaveLength(1);
    await service.search('business problems', context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ search_depth: 'basic', auto_parameters: false, include_usage: true });
    expect([...rows.values()][0]).toMatchObject({ status: 'COMPLETED', reportedCredits: 1 });
  });
  it('extracts a single public URL', async () => {
    const { service } = setup();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [{ url: 'https://example.com/a', raw_content: 'Observed customer complaint' }], usage: { credits: 1 } })));
    expect((await service.extract('https://example.com/a', { agent: 'RESEARCH', key: 'extract' })).results[0].raw_content).toContain('complaint');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).urls).toEqual(['https://example.com/a']);
    expect(() => service.extract('https://127.0.0.1/', { agent: 'RESEARCH', key: 'blocked' })).toThrow();
  });
  it('fails disabled configuration without reserving or calling the API', async () => {
    const { service, table } = setup({ TAVILY_ENABLED: 'false' });
    await expect(service.search('query', { agent: 'CLIENT', key: 'disabled' })).rejects.toThrow('disabled');
    expect(table.create).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([['timeout', null], ['API failure', 401], ['malformed response', 200]])('isolates %s and never exposes provider errors or secrets', async (_, status) => {
    const { service, rows } = setup();
    if (status === null) fetchMock.mockRejectedValue(new Error('secret-fixture socket timeout'));
    else fetchMock.mockResolvedValue(new Response('secret-fixture', { status }));
    await expect(service.search('query', { agent: 'CLIENT', key: 'failure' })).rejects.toThrow('Tavily');
    const row = [...rows.values()][0];
    expect(JSON.stringify(row)).not.toContain('secret-fixture'); expect(row.status).not.toBe('COMPLETED');
    await expect(service.search('query', { agent: 'CLIENT', key: 'failure' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('bounds retries across job replays and respects long Retry-After', async () => {
    const { service, rows } = setup({ TAVILY_MAX_RETRIES: '2' });
    fetchMock.mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    const context = { agent: 'CLIENT' as const, key: 'rate-limit' };
    await expect(service.search('query', context)).rejects.toThrow('HTTP_429');
    await expect(service.search('query', context)).rejects.toThrow('deferred');
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(rows.size).toBe(1);
  });
  it('refuses a request when the shared credit cap is exhausted', async () => {
    const { service, table } = setup({ TAVILY_DAILY_CREDIT_LIMIT: '1' });
    table.aggregate.mockResolvedValue({ _sum: { reservedCredits: 1 } });
    await expect(service.search('query', { agent: 'CLIENT', key: 'cap' })).rejects.toThrow('credit limit');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('aborts an actual stalled transport at the configured deadline', async () => {
    const { service } = setup({ TAVILY_REQUEST_TIMEOUT_MS: '1000' });
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await expect(service.search('query', { agent: 'CLIENT', key: 'deadline' })).rejects.toThrow('NETWORK_OR_TIMEOUT');
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('retries a transient failure once and caches the successful second attempt', async () => {
    const { service, rows } = setup({ TAVILY_MAX_RETRIES: '1' });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{"results":[]}'));
    const context = { agent: 'CLIENT' as const, key: 'recovery' };
    expect((await service.search('query', context)).results).toEqual([]);
    await service.search('query', context);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(rows.size).toBe(2);
  });
});
