import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { UsageService } from '../usage/usage.service';
import { AIService } from './ai.service';
@Module({ imports: [TelegramModule], providers: [AIService, UsageService], exports: [AIService, UsageService] })
export class AIModule {}
