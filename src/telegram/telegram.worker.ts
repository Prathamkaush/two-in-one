import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { z } from 'zod';
import { TelegramService } from './telegram.service';
import { ExecutionService } from '../queues/execution.service';

@Processor('telegram', { concurrency: 1, limiter: { max: 1, duration: 1100 } })
export class TelegramWorker extends WorkerHost {
  constructor(private readonly telegram: TelegramService, private readonly executions: ExecutionService) { super(); }
  async process(job: Job) {
    return this.executions.execute('telegram', 'SYSTEM', job, async () => {
      if (job.name !== 'send') throw new Error('Unsupported Telegram operation');
      const data = z.object({ notificationId: z.string().min(1) }).strict().parse(job.data);
      await this.telegram.deliver(data.notificationId);
    });
  }
}
