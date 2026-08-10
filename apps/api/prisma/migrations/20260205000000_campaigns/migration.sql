-- LinkIQ — Sprint 5: Campaign Management & UTM Tracking
-- Adds campaigns table and campaignId/UTM columns on links. Mirrors
-- schema.prisma exactly.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- ---------------------------------------------------------------------------
-- campaigns table
-- ---------------------------------------------------------------------------

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaigns_workspaceId_idx" ON "campaigns"("workspaceId");
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX "campaigns_createdById_idx" ON "campaigns"("createdById");

-- Campaign names are unique within a workspace, but only among
-- non-deleted campaigns — a partial unique index (not a plain @@unique,
-- which Prisma's schema DSL can't express here) so a soft-deleted
-- campaign's name becomes reusable again, the same way a real "delete
-- and recreate with the same name" would behave to a user.
CREATE UNIQUE INDEX "campaigns_workspaceId_name_key"
    ON "campaigns"("workspaceId", "name")
    WHERE "deletedAt" IS NULL;

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- links: campaign association + resolved UTM snapshot
-- ---------------------------------------------------------------------------

ALTER TABLE "links" ADD COLUMN "campaignId" UUID;
ALTER TABLE "links" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "links" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "links" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "links" ADD COLUMN "utmTerm" TEXT;
ALTER TABLE "links" ADD COLUMN "utmContent" TEXT;

CREATE INDEX "links_campaignId_idx" ON "links"("campaignId");

-- SetNull, not Cascade: deleting/archiving a campaign must never delete
-- or disable the links that reference it.
ALTER TABLE "links" ADD CONSTRAINT "links_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
