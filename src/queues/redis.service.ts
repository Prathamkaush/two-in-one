import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { Settings } from '../common/config/settings.service';
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor(settings: Settings) {
    this.client = new Redis({ host: settings.get('REDIS_HOST'), port: settings.get('REDIS_PORT'),
      password: settings.get('REDIS_PASSWORD') || undefined, maxRetriesPerRequest: 1,
      connectTimeout: 2000, commandTimeout: 2000 });
    this.client.on('error', () => new Logger(RedisService.name).warn('Redis connection unavailable'));
  }
  async onModuleDestroy() { this.client.disconnect(); }
}
