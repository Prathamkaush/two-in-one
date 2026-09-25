import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ExecutionService } from '../queues/execution.service';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { ClientWorkers } from './client.workers';
import { TavilyModule } from '../tavily/tavily.module';
import { TavilyBusinessSource } from './discovery/tavily.source';
@Module({ imports: [AIModule, TelegramModule, TavilyModule], controllers: [ClientController],
  providers: [ClientService, TavilyBusinessSource, ExecutionService, ...ClientWorkers], exports: [ClientService] })
export class ClientModule {}
