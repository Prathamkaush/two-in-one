import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Settings } from '../common/config/settings.service';
import { QueueService } from './queues.service';
import { RedisService } from './redis.service';

export const QUEUES = ['lead-discovery', 'lead-analysis', 'website-analysis', 'pitch-generation',
  'research-collection', 'research-processing', 'research-analysis', 'monthly-analysis', 'telegram', 'maintenance'] as const;
export type QueueName = typeof QUEUES[number];

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({ inject: [Settings], useFactory: (settings: Settings) => ({
      connection: { host: settings.get('REDIS_HOST'), port: settings.get('REDIS_PORT'),
        password: settings.get('REDIS_PASSWORD') || undefined },
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: false, removeOnFail: false },
    }) }),
    BullModule.registerQueue(...QUEUES.map((name) => ({ name }))),
  ],
  providers: [QueueService, RedisService], exports: [BullModule, QueueService, RedisService],
})
export class QueuesModule {}
