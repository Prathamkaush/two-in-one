-- AlterTable
ALTER TABLE "BusinessLead" ADD COLUMN     "presentedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentConfiguration" (
    "agent" "Agent" NOT NULL,
    "configuration" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfiguration_pkey" PRIMARY KEY ("agent")
);

-- CreateTable
CREATE TABLE "ClientBatch" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "selected" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientBatch_date_key" ON "ClientBatch"("date");
