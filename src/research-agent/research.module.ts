import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ExecutionService } from '../queues/execution.service';
import { ResearchService } from './research.service';
import { ResearchController } from './research.controller';
import { ResearchWorkers } from './research.workers';
import { TavilyModule } from '../tavily/tavily.module';
@Module({ imports: [AIModule, TelegramModule, TavilyModule], controllers: [ResearchController],
  providers: [ResearchService, ExecutionService, ...ResearchWorkers], exports: [ResearchService] })
export class ResearchModule {}
