import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../queues/redis.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService, private readonly redis: RedisService) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready() {
    const results = await Promise.allSettled([this.db.$queryRaw`SELECT 1`, this.redis.client.ping()]);
    const status = { postgres: results[0].status === 'fulfilled', redis: results[1].status === 'fulfilled' };
    if (!status.postgres || !status.redis) throw new ServiceUnavailableException({ status: 'unavailable', dependencies: status });
    return { status: 'ok', dependencies: status };
  }
}
