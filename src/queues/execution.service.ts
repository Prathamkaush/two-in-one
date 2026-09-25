import { Injectable } from '@nestjs/common';
import { Agent } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { redact } from '../common/logging/safe-logger';

@Injectable()
export class ExecutionService {
  constructor(private readonly db: PrismaService) {}
  async execute<T>(queue: string, agent: Agent, job: Job, operation: () => Promise<T>): Promise<T | undefined> {
    if (!job.id) throw new Error('Missing durable job ID');
    const idempotencyKey = `${queue}/${job.id}`;
    const existing = await this.db.automationRun.findUnique({ where: { idempotencyKey } });
    if (existing?.status === 'COMPLETED') return;
    const start = new Date();
    const run = await this.db.automationRun.upsert({ where: { idempotencyKey },
      create: { agent, jobType: job.name, idempotencyKey },
      update: { status: 'RUNNING', finishedAt: null, errorDetails: null } });
    const execution = await this.db.jobExecution.upsert({
      where: { queue_jobId_attempt: { queue, jobId: job.id, attempt: job.attemptsMade + 1 } },
      create: { queue, jobId: job.id, attempt: job.attemptsMade + 1, runId: run.id },
      update: { status: 'RUNNING', startedAt: start, finishedAt: null, errorDetails: null },
    });
    try {
      const result = await operation();
      const finishedAt = new Date();
      await this.db.$transaction([
        this.db.jobExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', finishedAt } }),
        this.db.automationRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', finishedAt,
          durationMs: finishedAt.getTime() - start.getTime(), itemsProcessed: 1, itemsSucceeded: 1, itemsFailed: 0 } }),
      ]);
      return result;
    } catch (error) {
      const message = redact(error);
      const finishedAt = new Date();
      await this.db.$transaction([
        this.db.jobExecution.update({ where: { id: execution.id }, data: { status: 'FAILED', finishedAt, errorDetails: message } }),
        this.db.automationRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt,
          durationMs: finishedAt.getTime() - start.getTime(), itemsProcessed: 1, itemsFailed: 1, errorDetails: message } }),
        this.db.systemError.create({ data: { agent, queue, jobId: job.id, message,
          critical: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) } }),
      ]);
      throw new Error(message);
    }
  }
}
