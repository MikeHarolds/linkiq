-- LinkIQ — Sprint 3: Analytics & Click Intelligence
-- Expands click_events with analytics fields (dropping raw IP storage in
-- favor of a privacy-safe visitor hash) and adds the link_daily_stats
-- UTC-day rollup table. Mirrors schema.prisma exactly.

-- ---------------------------------------------------------------------------
-- click_events: drop raw IP + old referer column, add analytics columns
-- ---------------------------------------------------------------------------

ALTER TABLE "click_events" DROP COLUMN IF EXISTS "ipAddress";
ALTER TABLE "click_events" DROP COLUMN IF EXISTS "referer";

ALTER TABLE "click_events" ADD COLUMN "visitorHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "click_events" ALTER COLUMN "visitorHash" DROP DEFAULT;

ALTER TABLE "click_events" ADD COLUMN "country" TEXT;
ALTER TABLE "click_events" ADD COLUMN "region" TEXT;
ALTER TABLE "click_events" ADD COLUMN "city" TEXT;
ALTER TABLE "click_events" ADD COLUMN "deviceType" TEXT;
ALTER TABLE "click_events" ADD COLUMN "os" TEXT;
ALTER TABLE "click_events" ADD COLUMN "browser" TEXT;
-- userAgent already exists (added as unbounded TEXT in the Sprint 2
-- migration) — widen its constraint instead of adding a duplicate column.
ALTER TABLE "click_events" ALTER COLUMN "userAgent" TYPE VARCHAR(512);
ALTER TABLE "click_events" ADD COLUMN "referrerUrl" VARCHAR(2048);
ALTER TABLE "click_events" ADD COLUMN "referrerDomain" TEXT;
ALTER TABLE "click_events" ADD COLUMN "referrerCategory" TEXT;
ALTER TABLE "click_events" ADD COLUMN "queryParams" JSONB;
ALTER TABLE "click_events" ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "click_events_workspaceId_occurredAt_idx" ON "click_events"("workspaceId", "occurredAt");
CREATE INDEX "click_events_linkId_occurredAt_idx" ON "click_events"("linkId", "occurredAt");

-- ---------------------------------------------------------------------------
-- link_daily_stats: new rollup table
-- ---------------------------------------------------------------------------

CREATE TABLE "link_daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "linkId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "totalClicks" INTEGER NOT NULL DEFAULT 0,
    "humanClicks" INTEGER NOT NULL DEFAULT 0,
    "botClicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "link_daily_stats_linkId_date_key" ON "link_daily_stats"("linkId", "date");
CREATE INDEX "link_daily_stats_workspaceId_date_idx" ON "link_daily_stats"("workspaceId", "date");

ALTER TABLE "link_daily_stats" ADD CONSTRAINT "link_daily_stats_linkId_fkey"
    FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
