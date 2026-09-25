import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/security/admin.guard';
import { TavilyService } from './tavily.service';
@Controller('admin/tavily')
@UseGuards(AdminGuard)
export class TavilyController {
  constructor(private readonly tavily: TavilyService) {}
  @Get('status') async status() { return { enabled: this.tavily.enabled(), last24Hours: await this.tavily.activity() }; }
  @Post('test') async test() {
    const response = await this.tavily.search('Delhi small business public websites', { agent: 'SYSTEM', key: `connectivity-${new Date().toISOString().slice(0, 10)}` });
    return { ok: true, results: response.results.length, note: 'Connectivity response is cached for this UTC day.' };
  }
}
