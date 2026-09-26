import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from '../common/security/admin.guard';
import { ClientService } from './client.service';
import { PrismaService } from '../database/prisma.service';
@Controller('admin/client')
@UseGuards(AdminGuard)
export class ClientController {
  constructor(private readonly client: ClientService, private readonly db: PrismaService) {}
  @Get('configuration') configuration() { return this.client.configuration(); }
  @Put('configuration') configure(@Body() body: unknown) { return this.client.configure(body); }
  @Post('candidates') ingest(@Body() body: unknown) { return this.client.ingest(body); }
  @Post('run') run() { return this.client.trigger(); }
  @Post('discovery-preview') preview() { return this.client.previewDiscovery(); }
  @Get('batches') batches() { return this.db.clientBatch.findMany({ take: 30, orderBy: { createdAt: 'desc' } }); }
  @Get('batches/:id') batch(@Param('id') id: string) { return this.db.clientBatch.findUniqueOrThrow({ where: { id } }); }
  @Get('leads') leads() { return this.db.businessLead.findMany({ take: 100, orderBy: { discoveredAt: 'desc' }, include: { drafts: true, sources: true } }); }
  @Patch('leads/:id') async update(@Param('id') id: string, @Body() body: unknown) {
    const result = z.object({ status: z.enum(['CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATING', 'WON', 'LOST', 'REJECTED']).optional(), notes: z.string().max(5000).optional() }).strict().safeParse(body);
    if (!result.success) throw new BadRequestException('Invalid lead update');
    return this.db.businessLead.update({ where: { id }, data: result.data });
  }
}
