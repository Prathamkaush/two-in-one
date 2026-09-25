import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { z } from 'zod';
import { ResearchService } from './research.service';
import { ExecutionService } from '../queues/execution.service';
import { TelegramService } from '../telegram/telegram.service';
function researchWorker(queue: string) {
  @Processor(queue, { concurrency: 1, limiter: { max: 10, duration: 60000 } })
  class ResearchWorker extends WorkerHost {
    constructor(private readonly research: ResearchService, private readonly executions: ExecutionService, private readonly telegram: TelegramService) { super(); }
    async process(job: Job) {
      try {
        return await this.executions.execute(queue, 'RESEARCH', job, async () => {
          if (queue === 'research-collection') {
            const data = z.object({ cycleId: z.string(), sourceId: z.string(), slot: z.number().int().nonnegative().optional() }).parse(job.data);
            await this.research.collect(data.cycleId, data.sourceId, data.slot);
          } else if (queue === 'monthly-analysis') {
            await this.research.monthly(z.object({ cycleId: z.string() }).parse(job.data).cycleId);
          } else {
            const id = z.object({ itemId: z.string() }).parse(job.data).itemId;
            if (queue === 'research-processing') await this.research.process(id); else await this.research.cluster(id);
          }
        });
      } catch (error) {
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await this.telegram.notify(`failed-${queue}-${job.id}`,
          `ALERT\nResearch Agent\n${queue} exhausted retries. Other source jobs continue. Inspect protected run logs.`, "RESEARCH").catch(() => undefined);
        throw error;
      }
    }
  }
  return ResearchWorker;
}
export const ResearchWorkers = ['research-collection', 'research-processing', 'research-analysis', 'monthly-analysis'].map(researchWorker);
