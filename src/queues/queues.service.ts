import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import type { QueueName } from './queues.module';

export function jobKey(queue: string, operation: string, key: string): string {
  return createHash('sha256').update(JSON.stringify([queue, operation, key])).digest('hex');
}
@Injectable()
export class QueueService {
  constructor(private readonly moduleRef: ModuleRef) {}
  get(name: QueueName): Queue { return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false }); }
  async enqueue(name: QueueName, operation: string, key: string, data: Record<string, unknown>) {
    const id = jobKey(name, operation, key);
    await this.get(name).add(operation, data, { jobId: id });
    return id;
  }
}
