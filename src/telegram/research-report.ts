import { Agent } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TelegramService } from './telegram.service';
export async function sendResearchReport(db: PrismaService, telegram: TelegramService, cycleId: string, notificationKey: string, bot: Agent = 'RESEARCH') {
    const report = await db.monthlyReport.findUnique({ where: { cycleId }, include: { opportunities: { orderBy: { rank: 'asc' } } } });
    if (!report) return false;
    await telegram.notify(`${notificationKey}-summary`,
      `FINAL RESEARCH REPORT\nCycle: ${cycleId}\nOpportunities: ${report.opportunities.length}\n${report.insufficiencyReason ?? 'Evidence-backed hypotheses for manual validation.'}\nCollection has ended. No new cycle starts automatically.\nFull data: GET /admin/research/reports/${report.id}`, bot);
    for (const opportunity of report.opportunities) {
      const refs = Array.isArray(opportunity.sourceReferences) ? opportunity.sourceReferences.filter((id): id is string => typeof id === 'string') : [];
      const sources = await db.researchItem.findMany({ where: { cycleId, id: { in: refs } }, select: { sourceUrl: true }, take: 2 });
      await telegram.notify(`${notificationKey}-${opportunity.id}`,
        [`${opportunity.rank}. ${opportunity.name.slice(0, 100)}`, `Problem: ${opportunity.problem.slice(0, 220)}`,
          `Customer: ${opportunity.targetCustomer.slice(0, 120)}`, `Proposed MVP: ${opportunity.mvp.slice(0, 250)}`,
          `Business model: ${opportunity.businessModel.slice(0, 150)}`, `Confidence: ${opportunity.confidence}`,
          `Validate: ${JSON.stringify(opportunity.validationExperiments).slice(0, 220)}`,
          `Sources:\n${sources.map((source) => source.sourceUrl.slice(0, 200)).join('\n')}`,
          'Hypothesis, not validated market demand. Full analysis is in the report.'].join('\n\n'), bot);
    }
    return true;
  }
