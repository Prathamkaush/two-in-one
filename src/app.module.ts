import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './common/config/environment';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { QueuesModule } from './queues/queues.module';
import { TelegramModule } from './telegram/telegram.module';
import { AIModule } from './ai/ai.module';
import { HealthController } from './health/health.controller';
import { AdminController } from './admin/admin.controller';
import { MaintenanceService } from './scheduler/maintenance.service';
import { ClientModule } from './client-agent/client.module';
import { AgentsScheduler } from './scheduler/agents.scheduler';
import { ResearchModule } from './research-agent/research.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }), CommonModule, DatabaseModule,
    QueuesModule, TelegramModule, AIModule, ClientModule, ResearchModule, ScheduleModule.forRoot(), ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
  controllers: [HealthController, AdminController],
  providers: [MaintenanceService, AgentsScheduler, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
