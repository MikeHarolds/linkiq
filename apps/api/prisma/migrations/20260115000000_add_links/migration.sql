-- LinkIQ — Sprint 2: Link Management Engine
-- Adds links and click_events tables. Mirrors schema.prisma exactly.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "LinkStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "createdById" UUID,
    "destinationUrl" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "status" "LinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "click_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "linkId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "click_events_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes / unique constraints
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "links_shortCode_key" ON "links"("shortCode");
CREATE INDEX "links_workspaceId_idx" ON "links"("workspaceId");
CREATE INDEX "links_createdById_idx" ON "links"("createdById");
CREATE INDEX "links_status_idx" ON "links"("status");
CREATE INDEX "links_expiresAt_idx" ON "links"("expiresAt");
CREATE INDEX "links_createdAt_idx" ON "links"("createdAt");
CREATE INDEX "links_shortCode_deletedAt_idx" ON "links"("shortCode", "deletedAt");

CREATE INDEX "click_events_linkId_idx" ON "click_events"("linkId");
CREATE INDEX "click_events_workspaceId_idx" ON "click_events"("workspaceId");
CREATE INDEX "click_events_occurredAt_idx" ON "click_events"("occurredAt");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "links" ADD CONSTRAINT "links_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "links" ADD CONSTRAINT "links_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "click_events" ADD CONSTRAINT "click_events_linkId_fkey"
    FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
