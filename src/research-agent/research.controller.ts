import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from '../common/security/admin.guard';
import { PrismaService } from '../database/prisma.service';
import { ResearchService } from './research.service';
import { QueueService } from '../queues/queues.service';
import { jobKey } from '../queues/queues.service';
@Controller('admin/research')
@UseGuards(AdminGuard)
export class ResearchController {
  constructor(private readonly research: ResearchService, private readonly db: PrismaService, private readonly queues: QueueService) {}
  @Post('cycles') start() { return this.research.startCycle(); }
  @Get('cycles') cycles() { return this.db.researchCycle.findMany({ take: 50, orderBy: { createdAt: 'desc' } }); }
  @Get('cycles/:id/diagnostics') async diagnostics(@Param('id') id: string) {
    const cycle = await this.db.researchCycle.findUniqueOrThrow({ where: { id }, include: { report: { select: { id: true, createdAt: true } } } });
    const jobId = jobKey('monthly-analysis', 'final-report', id);
    const job = await this.queues.get('monthly-analysis').getJob(jobId);
    return { cycle, jobId, queueState: job ? await job.getState() : 'missing',
      pendingItems: await this.db.researchItem.count({ where: { cycleId: id, status: 'PENDING' } }),
      attempts: await this.db.jobExecution.findMany({ where: { queue: 'monthly-analysis', jobId }, orderBy: { startedAt: 'desc' }, take: 5,
        select: { status: true, attempt: true, errorDetails: true, startedAt: true } }),
      aiRequests: await this.db.aIUsage.findMany({ where: { job: id, agent: 'RESEARCH' }, select: { requestKey: true, status: true, model: true,
        inputTokens: true, outputTokens: true, estimatedCost: true, createdAt: true } }) };
  }
  @Get('cycles/:id/items') items(@Param('id') id: string) { return this.db.researchItem.findMany({ where: { cycleId: id }, take: 100, orderBy: { collectedAt: 'desc' } }); }
  @Get('sources') sources() { return this.db.researchSource.findMany(); }
  @Post('sources') source(@Body() body: unknown) { return this.research.addSource(body); }
  @Post('collect') collect() { return this.research.collectNow(); }
  @Post('summary') summary() { return this.research.dailySummary(); }
  @Post('cycles/:id/items/:sourceId') ingest(@Param('id') id: string, @Param('sourceId') sourceId: string, @Body() body: unknown) { return this.research.ingest(id, sourceId, body); }
  @Post('items/:id/process') async process(@Param('id') id: string) { return { jobId: await this.queues.enqueue('research-processing', 'extract', id, { itemId: id }) }; }
  @Post('cycles/:id/finalize') finalize(@Param('id') id: string, @Body() body: unknown) {
    const result = z.object({ simulate: z.boolean().default(false) }).strict().safeParse(body ?? {});
    if (!result.success) throw new BadRequestException('Expected optional simulate boolean');
    return this.research.finalize(id, result.data.simulate);
  }
  @Get('reports/:id') report(@Param('id') id: string) { return this.db.monthlyReport.findUniqueOrThrow({ where: { id }, include: { opportunities: { orderBy: { rank: 'asc' } } } }); }
}
