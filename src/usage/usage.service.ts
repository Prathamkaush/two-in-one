import { Injectable, Logger } from '@nestjs/common';
import { Agent, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { Settings } from '../common/config/settings.service';
import { TelegramService } from '../telegram/telegram.service';
import { budgetThreshold, ModelPrice, utcPeriods } from './budget';

export class BudgetExceededError extends Error {}
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  constructor(private readonly db: PrismaService, private readonly settings: Settings, private readonly telegram: TelegramService) {}
  private async totals(tx: Prisma.TransactionClient, now: Date) {
    const { day, month } = utcPeriods(now);
    const aggregate = async (gte: Date) => Number((await tx.aIUsage.aggregate({
      where: { createdAt: { gte } }, _sum: { estimatedCost: true },
    }))._sum.estimatedCost ?? 0);
    return { daily: await aggregate(day), monthly: await aggregate(month) };
  }
  async summary() { return this.totals(this.db, new Date()); }
  async completed(requestKey: string) {
    const usage = await this.db.aIUsage.findUnique({ where: { requestKey } });
    return usage?.status === 'SETTLED' ? usage.result : null;
  }
  async reserve(request: { requestKey: string; agent: Agent; job: string; model: string; maximumCost: number; price: ModelPrice; optional: boolean }) {
    if (!Number.isFinite(request.maximumCost) || request.maximumCost <= 0) throw new Error('Invalid reservation');
    const reservation = await this.db.$transaction(async (tx) => {
      // All callers serialize reservation checks in PostgreSQL, including across processes.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71829341)::text`;
      if (await tx.aIUsage.findUnique({ where: { requestKey: request.requestKey } })) {
        throw new Error('AI request already reserved or executed; explicit reconciliation required');
      }
      const totals = await this.totals(tx, new Date());
      const dailyLimit = this.settings.get('OPENAI_DAILY_BUDGET_USD');
      const monthlyLimit = this.settings.get('OPENAI_MONTHLY_BUDGET_USD');
      const critical = Math.max(totals.daily / dailyLimit, totals.monthly / monthlyLimit) >= 0.95;
      if (totals.daily + request.maximumCost > dailyLimit || totals.monthly + request.maximumCost > monthlyLimit ||
        (critical && request.optional && this.settings.get('OPENAI_DISABLE_NONESSENTIAL_AT_95'))) {
        return null;
      }
      return tx.aIUsage.create({ data: { requestKey: request.requestKey, agent: request.agent, job: request.job,
        model: request.model, estimatedCost: request.maximumCost, priceSnapshot: { ...request.price } } });
    }, { timeout: 15000, maxWait: 15000, isolationLevel: 'ReadCommitted' });
    if (!reservation) {
      await this.safeNotify(`budget-blocked-${new Date().toISOString().slice(0, 10)}`, 'AI budget guard blocked work: configured spending limit or 95% optional-work threshold reached.');
      throw new BudgetExceededError('AI budget prevents this request');
    }
    await this.checkAlerts();
    return reservation.id;
  }
  async settle(id: string, inputTokens: number, outputTokens: number, cost: number, result?: Prisma.InputJsonValue) {
    await this.db.aIUsage.update({ where: { id }, data: { inputTokens, outputTokens, estimatedCost: cost,
      status: 'SETTLED', settledAt: new Date(), ...(result ? { result } : {}) } });
    await this.checkAlerts();
  }
  async uncertain(id: string) {
    // Keep the full reservation after timeout/refusal/unknown billing. Never automatically refund ambiguous API work.
    await this.db.aIUsage.update({ where: { id }, data: { status: 'UNCERTAIN' } });
  }
  private async safeNotify(key: string, message: string) {
    try { await this.telegram.notify(key, message); }
    catch { this.logger.error('Budget notification unavailable; spending protection remains active'); }
  }
  private async checkAlerts() {
    try {
      const totals = await this.summary();
      const now = new Date().toISOString();
      for (const [period, spent, limit] of [
        [`day-${now.slice(0, 10)}`, totals.daily, this.settings.get('OPENAI_DAILY_BUDGET_USD')],
        [`month-${now.slice(0, 7)}`, totals.monthly, this.settings.get('OPENAI_MONTHLY_BUDGET_USD')],
      ] as const) {
        const threshold = budgetThreshold(spent, limit);
        if (!threshold) continue;
        await this.safeNotify(`budget-${period}-${threshold}`, `AI BUDGET ${threshold >= 95 ? 'CRITICAL' : 'WARNING'}: ${period} reached ${threshold}% (includes pending reservations).`);
      }
    } catch { this.logger.error('Budget alert check failed'); }
  }
}
