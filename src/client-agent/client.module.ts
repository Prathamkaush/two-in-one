import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ExecutionService } from '../queues/execution.service';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { ClientWorkers } from './client.workers';
@Module({ imports: [AIModule, TelegramModule], controllers: [ClientController],
  providers: [ClientService, ExecutionService, ...ClientWorkers], exports: [ClientService] })
export class ClientModule {}
