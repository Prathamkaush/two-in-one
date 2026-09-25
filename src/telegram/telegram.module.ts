import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramWorker } from './telegram.worker';
import { ExecutionService } from '../queues/execution.service';
import { TelegramController } from './telegram.controller';
@Module({ controllers: [TelegramController], providers: [TelegramService, TelegramWorker, ExecutionService], exports: [TelegramService] })
export class TelegramModule {}
