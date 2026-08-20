-- LinkIQ — Explicit Link Source / Campaign Attribution
-- Adds link_sources table (named tracking variants of a Link) and the
-- resolved-attribution columns on click_events. Purely additive: no
-- existing table, column, or row is modified. Mirrors schema.prisma
-- exactly.

-- ---------------------------------------------------------------------------
-- ApiKeyPermission: two new scopes, same shape as QRCODES_READ/WRITE
-- ---------------------------------------------------------------------------

ALTER TYPE "ApiKeyPermission" ADD VALUE 'LINK_SOURCES_READ';
ALTER TYPE "ApiKeyPermission" ADD VALUE 'LINK_SOURCES_WRITE';

-- ---------------------------------------------------------------------------
-- WebhookEventType: three new events, same shape as QRCODE_CREATED/UPDATED/DELETED
-- ---------------------------------------------------------------------------

ALTER TYPE "WebhookEventType" ADD VALUE 'LINK_SOURCE_CREATED';
ALTER TYPE "WebhookEventType" ADD VALUE 'LINK_SOURCE_UPDATED';
ALTER TYPE "WebhookEventType" ADD VALUE 'LINK_SOURCE_DELETED';

-- ---------------------------------------------------------------------------
-- link_sources table
-- ---------------------------------------------------------------------------

CREATE TABLE "link_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "linkId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "campaign" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "link_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "link_sources_workspaceId_idx" ON "link_sources"("workspaceId");
CREATE INDEX "link_sources_linkId_idx" ON "link_sources"("linkId");
CREATE INDEX "link_sources_createdById_idx" ON "link_sources"("createdById");
CREATE INDEX "link_sources_linkId_source_idx" ON "link_sources"("linkId", "source");

-- One non-deleted variant per (link, source) — same partial-unique
-- pattern as campaigns_workspaceId_name_key, so a fresh row can be
-- created again after a real delete.
CREATE UNIQUE INDEX "link_sources_linkId_source_key"
    ON "link_sources"("linkId", "source")
    WHERE "deletedAt" IS NULL;

ALTER TABLE "link_sources" ADD CONSTRAINT "link_sources_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "link_sources" ADD CONSTRAINT "link_sources_linkId_fkey"
    FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "link_sources" ADD CONSTRAINT "link_sources_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- click_events: resolved attribution snapshot (additive columns only)
-- ---------------------------------------------------------------------------

ALTER TABLE "click_events" ADD COLUMN "linkSourceId" UUID;
ALTER TABLE "click_events" ADD COLUMN "attributedSource" TEXT;
ALTER TABLE "click_events" ADD COLUMN "attributedMedium" TEXT;
ALTER TABLE "click_events" ADD COLUMN "attributedCampaign" TEXT;
ALTER TABLE "click_events" ADD COLUMN "attributionType" TEXT;

CREATE INDEX "click_events_linkSourceId_idx" ON "click_events"("linkSourceId");

-- SetNull, not Cascade: deleting a LinkSource must never delete the
-- ClickEvent rows already attributed to it — they keep their own
-- denormalized attributedSource/Medium/Campaign snapshot regardless.
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_linkSourceId_fkey"
    FOREIGN KEY ("linkSourceId") REFERENCES "link_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
