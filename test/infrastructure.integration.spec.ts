import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { Settings } from '../src/common/config/settings.service';
import { RedisService } from '../src/queues/redis.service';
import { HealthController } from '../src/health/health.controller';
import { UsageService } from '../src/usage/usage.service';
import { TelegramService } from '../src/telegram/telegram.service';

describe('live infrastructure', () => {
  const db = new PrismaService();
  let app: INestApplication;
  let redis: RedisService;
  beforeAll(async () => {
    if (!process.env.INTEGRATION_TEST_DATABASE?.startsWith('automation_test_')) throw new Error('Use npm run test:integration');
    await db.$connect();
    const settings = new Settings(new ConfigService({ REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: Number(process.env.REDIS_PORT || 56379), REDIS_PASSWORD: process.env.REDIS_PASSWORD || '' }));
    redis = new RedisService(settings);
    const module = await Test.createTestingModule({ controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: db }, { provide: RedisService, useValue: redis }] }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => { if (app) await app.close(); redis?.client.disconnect(); await db.$disconnect(); });
  it('serves readiness only with PostgreSQL and Redis reachable', async () => {
    await request(app.getHttpServer()).get('/health/ready').expect(200).expect({ status: 'ok', dependencies: { postgres: true, redis: true } });
  });
  it('enforces duplicate lead identities at the database level', async () => {
    await db.businessLead.create({ data: { identityKey: 'test-business', businessName: 'Test' } });
    await expect(db.businessLead.create({ data: { identityKey: 'test-business', businessName: 'Duplicate' } })).rejects.toMatchObject({ code: 'P2002' });
  });
  it('preserves research provenance and allows evidence in subsequent cycles', async () => {
    const source = await db.researchSource.create({ data: { name: 'fixture', adapter: 'fixture' } });
    const cycle = await db.researchCycle.create({ data: { startDate: new Date(), endDate: new Date(), timezone: 'UTC' } });
    const data = { cycleId: cycle.id, sourceId: source.id, sourceUrl: 'https://example.com/a', canonicalUrl: 'https://example.com/a', contentHash: 'hash', title: 'Evidence', content: 'Observed problem' };
    await db.researchItem.create({ data });
    await expect(db.researchItem.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    const next = await db.researchCycle.create({ data: { startDate: new Date(), endDate: new Date(), timezone: 'UTC' } });
    await db.researchItem.create({ data: { ...data, cycleId: next.id } });
    expect(await db.researchItem.count({ where: { sourceId: source.id } })).toBe(2);
  });
  it('serializes concurrent AI reservations so budgets cannot be oversubscribed', async () => {
    const settings = new Settings(new ConfigService({ OPENAI_DAILY_BUDGET_USD: 1, OPENAI_MONTHLY_BUDGET_USD: 1, OPENAI_DISABLE_NONESSENTIAL_AT_95: true }));
    const telegram = { notify: jest.fn() } as unknown as TelegramService;
    const usage = new UsageService(db, settings, telegram);
    const reserve = (key: string) => usage.reserve({ requestKey: key, agent: 'RESEARCH', job: 'test', model: 'fixture',
      maximumCost: 0.6, optional: true, price: { input: 1, output: 1 } });
    const results = await Promise.allSettled([reserve('one'), reserve('two')]);
    const unexpected = results.find((r) => r.status === 'rejected' && !String(r.reason).includes('AI budget prevents'));
    if (unexpected?.status === 'rejected') throw unexpected.reason;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.aIUsage.count()).toBe(1);
    expect((await usage.summary()).daily).toBe(0.6);
  });
  it('runs BullMQ work once for duplicate IDs and persists completion across reconnects', async () => {
    const name = `test-${randomUUID()}`;
    const connection = { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 56379) };
    const queue = new Queue(name, { connection });
    const events = new QueueEvents(name, { connection });
    const handler = jest.fn(async () => 'done');
    const worker = new Worker(name, handler, { connection });
    try {
      await events.waitUntilReady();
      const job = await queue.add('test', {}, { jobId: 'stable', removeOnComplete: false });
      expect(await job.waitUntilFinished(events, 10000)).toBe('done');
      await queue.add('test', {}, { jobId: 'stable' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(await (await queue.getJob('stable'))?.getState()).toBe('completed');
    } finally {
      await worker.close(); await events.close(); await queue.obliterate({ force: true }); await queue.close();
    }
  });
});
