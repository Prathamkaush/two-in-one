ALTER TABLE "Notification" ADD COLUMN "agent" "Agent" NOT NULL DEFAULT 'SYSTEM';
UPDATE "Notification" SET "agent" = 'CLIENT' WHERE "key" LIKE 'client-%' OR "key" LIKE 'failed-lead-%' OR "key" LIKE 'failed-website-analysis-%' OR "key" LIKE 'failed-pitch-generation-%';
UPDATE "Notification" SET "agent" = 'RESEARCH' WHERE "key" LIKE 'research-%' OR "key" LIKE 'monthly-%' OR "key" LIKE 'failed-research-%' OR "key" LIKE 'failed-monthly-analysis-%';
