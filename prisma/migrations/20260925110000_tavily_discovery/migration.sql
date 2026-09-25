ALTER TABLE "ClientBatch" ADD COLUMN "discovery" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "TavilyRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestKey" TEXT NOT NULL,
  "agent" "Agent" NOT NULL,
  "operation" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "reservedCredits" INTEGER NOT NULL DEFAULT 1,
  "reportedCredits" DOUBLE PRECISION,
  "result" JSONB,
  "errorCode" TEXT,
  "retryAfterMs" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "TavilyRequest_requestKey_key" ON "TavilyRequest"("requestKey");
CREATE INDEX "TavilyRequest_createdAt_idx" ON "TavilyRequest"("createdAt");
CREATE INDEX "TavilyRequest_agent_createdAt_idx" ON "TavilyRequest"("agent", "createdAt");
