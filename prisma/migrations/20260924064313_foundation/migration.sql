-- CreateEnum
CREATE TYPE "Agent" AS ENUM ('CLIENT', 'RESEARCH', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('DISCOVERED', 'ANALYZED', 'QUALIFIED', 'PRESENTED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATING', 'WON', 'LOST', 'REJECTED');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('UNKNOWN', 'NO_WEBSITE', 'REACHABLE', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('PENDING', 'ACTIVE', 'ANALYZING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSED', 'IRRELEVANT', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "UsageStatus" AS ENUM ('RESERVED', 'SETTLED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "BusinessLead" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "location" TEXT,
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "socialUrls" JSONB NOT NULL DEFAULT '[]',
    "publicContact" JSONB NOT NULL DEFAULT '{}',
    "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "score" DOUBLE PRECISION,
    "selectionReason" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'DISCOVERED',
    "notes" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSource" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAnalysis" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "WebsiteStatus" NOT NULL,
    "https" BOOLEAN,
    "responseTimeMs" INTEGER,
    "httpStatus" INTEGER,
    "mobileViewport" BOOLEAN,
    "contactEvidence" JSONB,
    "freshnessEvidence" JSONB,
    "pageSpeed" JSONB,
    "limitations" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAnalysis" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "factors" JSONB NOT NULL,
    "weightsSnapshot" JSONB NOT NULL,
    "onlinePresence" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringConfiguration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "minimumScore" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "verifiedEvidence" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchCycle" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'PENDING',
    "currentDay" INTEGER NOT NULL DEFAULT 0,
    "totalItemsCollected" INTEGER NOT NULL DEFAULT 0,
    "totalItemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchItem" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "topic" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "duplicateOfId" TEXT,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "ResearchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSignal" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "clusterId" TEXT,
    "problem" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "evidenceQuote" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchCluster" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT,
    "evidenceSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityCandidate" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "analysis" JSONB NOT NULL,
    "dimensions" JSONB NOT NULL,
    "evidenceReferences" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalOpportunity" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "targetCustomer" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "importance" TEXT NOT NULL,
    "demandSignals" JSONB NOT NULL,
    "competitors" JSONB NOT NULL,
    "observedGap" TEXT NOT NULL,
    "proposedSolution" TEXT NOT NULL,
    "mvp" TEXT NOT NULL,
    "businessModel" TEXT NOT NULL,
    "monetization" JSONB NOT NULL,
    "technicalComplexity" TEXT NOT NULL,
    "mvpComplexity" TEXT NOT NULL,
    "risks" JSONB NOT NULL,
    "distribution" JSONB NOT NULL,
    "researchRationale" TEXT NOT NULL,
    "sourceReferences" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB NOT NULL,
    "validationExperiments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyReport" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "insufficiencyReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "agent" "Agent" NOT NULL,
    "jobType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "apiUsage" JSONB NOT NULL DEFAULT '{}',
    "aiCost" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "errorDetails" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "queue" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorDetails" TEXT,

    CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "agent" "Agent" NOT NULL,
    "job" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "UsageStatus" NOT NULL DEFAULT 'RESERVED',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(14,8) NOT NULL,
    "priceSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetAlert" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "agent" "Agent" NOT NULL,
    "date" TEXT NOT NULL,
    "cycleId" TEXT,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemError" (
    "id" TEXT NOT NULL,
    "agent" "Agent" NOT NULL,
    "queue" TEXT,
    "jobId" TEXT,
    "message" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessLead_identityKey_key" ON "BusinessLead"("identityKey");

-- CreateIndex
CREATE INDEX "BusinessLead_status_score_idx" ON "BusinessLead"("status", "score");

-- CreateIndex
CREATE INDEX "BusinessLead_discoveredAt_idx" ON "BusinessLead"("discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSource_leadId_sourceUrl_key" ON "BusinessSource"("leadId", "sourceUrl");

-- CreateIndex
CREATE INDEX "WebsiteAnalysis_leadId_createdAt_idx" ON "WebsiteAnalysis"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadAnalysis_leadId_createdAt_idx" ON "LeadAnalysis"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringConfiguration_name_key" ON "ScoringConfiguration"("name");

-- CreateIndex
CREATE INDEX "OutreachDraft_leadId_createdAt_idx" ON "OutreachDraft"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchCycle_status_endDate_idx" ON "ResearchCycle"("status", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_name_key" ON "ResearchSource"("name");

-- CreateIndex
CREATE INDEX "ResearchItem_cycleId_contentHash_idx" ON "ResearchItem"("cycleId", "contentHash");

-- CreateIndex
CREATE INDEX "ResearchItem_cycleId_status_idx" ON "ResearchItem"("cycleId", "status");

-- CreateIndex
CREATE INDEX "ResearchItem_sourceId_collectedAt_idx" ON "ResearchItem"("sourceId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchItem_cycleId_canonicalUrl_key" ON "ResearchItem"("cycleId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "ResearchSignal_clusterId_idx" ON "ResearchSignal"("clusterId");

-- CreateIndex
CREATE INDEX "ResearchSignal_itemId_idx" ON "ResearchSignal"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCluster_cycleId_key_key" ON "ResearchCluster"("cycleId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityCandidate_cycleId_clusterId_key" ON "OpportunityCandidate"("cycleId", "clusterId");

-- CreateIndex
CREATE INDEX "FinalOpportunity_cycleId_idx" ON "FinalOpportunity"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalOpportunity_reportId_rank_key" ON "FinalOpportunity"("reportId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReport_cycleId_key" ON "MonthlyReport"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_idempotencyKey_key" ON "AutomationRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationRun_agent_startedAt_idx" ON "AutomationRun"("agent", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobExecution_queue_jobId_attempt_key" ON "JobExecution"("queue", "jobId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "AIUsage_requestKey_key" ON "AIUsage"("requestKey");

-- CreateIndex
CREATE INDEX "AIUsage_createdAt_status_idx" ON "AIUsage"("createdAt", "status");

-- CreateIndex
CREATE INDEX "AIUsage_agent_createdAt_idx" ON "AIUsage"("agent", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetAlert_period_threshold_key" ON "BudgetAlert"("period", "threshold");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_agent_date_key" ON "DailyReport"("agent", "date");

-- CreateIndex
CREATE INDEX "SystemError_agent_createdAt_idx" ON "SystemError"("agent", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_key_key" ON "Notification"("key");

-- CreateIndex
CREATE INDEX "Notification_sentAt_createdAt_idx" ON "Notification"("sentAt", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessSource" ADD CONSTRAINT "BusinessSource_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "BusinessLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAnalysis" ADD CONSTRAINT "WebsiteAnalysis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "BusinessLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAnalysis" ADD CONSTRAINT "LeadAnalysis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "BusinessLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "BusinessLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchItem" ADD CONSTRAINT "ResearchItem_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ResearchCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchItem" ADD CONSTRAINT "ResearchItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchItem" ADD CONSTRAINT "ResearchItem_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "ResearchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSignal" ADD CONSTRAINT "ResearchSignal_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSignal" ADD CONSTRAINT "ResearchSignal_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ResearchCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCluster" ADD CONSTRAINT "ResearchCluster_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ResearchCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityCandidate" ADD CONSTRAINT "OpportunityCandidate_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ResearchCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityCandidate" ADD CONSTRAINT "OpportunityCandidate_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ResearchCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalOpportunity" ADD CONSTRAINT "FinalOpportunity_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ResearchCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalOpportunity" ADD CONSTRAINT "FinalOpportunity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "MonthlyReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyReport" ADD CONSTRAINT "MonthlyReport_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ResearchCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobExecution" ADD CONSTRAINT "JobExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
