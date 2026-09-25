import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { z } from 'zod';
import { ClientService } from './client.service';
import { ExecutionService } from '../queues/execution.service';
import { TelegramService } from '../telegram/telegram.service';

function clientWorker(queue: string, method: 'discover' | 'audit' | 'analyze' | 'draftAndReport') {
  @Processor(queue, { concurrency: 1, limiter: { max: 5, duration: 60000 } })
  class ClientWorker extends WorkerHost {
    constructor(private readonly client: ClientService, private readonly executions: ExecutionService, private readonly telegram: TelegramService) { super(); }
    async process(job: Job) {
      try {
        return await this.executions.execute(queue, 'CLIENT', job, async () => {
          const value = method === 'discover' ? z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(job.data).date
            : z.object({ batchId: z.string().min(1) }).parse(job.data).batchId;
          await this.client[method](value);
        });
      } catch (error) {
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
          await this.telegram.notify(`failed-${queue}-${job.id}`, `ALERT\nClient Agent\n${queue} exhausted retries. Review protected run logs.`, "CLIENT").catch(() => undefined);
        }
        throw error;
      }
    }
  }
  return ClientWorker;
}
export const ClientWorkers = [clientWorker('lead-discovery', 'discover'), clientWorker('website-analysis', 'audit'),
  clientWorker('lead-analysis', 'analyze'), clientWorker('pitch-generation', 'draftAndReport')];
