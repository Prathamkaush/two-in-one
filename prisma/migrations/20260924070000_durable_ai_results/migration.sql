ALTER TABLE "AIUsage" ADD COLUMN "result" JSONB;
ALTER TABLE "LeadAnalysis" ADD COLUMN "batchId" TEXT;
CREATE UNIQUE INDEX "LeadAnalysis_leadId_batchId_key" ON "LeadAnalysis"("leadId", "batchId");
