import { Module } from '@nestjs/common';
import { TavilyService } from './tavily.service';
import { TavilyController } from './tavily.controller';
@Module({ providers: [TavilyService], controllers: [TavilyController], exports: [TavilyService] })
export class TavilyModule {}
