-- LinkIQ — Sprint 4: QR Code Engine
-- Adds qr_codes table. Mirrors schema.prisma exactly.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "QrFormat" AS ENUM ('PNG', 'SVG');
CREATE TYPE "QrErrorCorrectionLevel" AS ENUM ('L', 'M', 'Q', 'H');

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "linkId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "format" "QrFormat" NOT NULL DEFAULT 'PNG',
    "size" INTEGER NOT NULL DEFAULT 512,
    "foregroundColor" TEXT NOT NULL DEFAULT '#000000',
    "backgroundColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "errorCorrectionLevel" "QrErrorCorrectionLevel" NOT NULL DEFAULT 'M',
    "margin" INTEGER NOT NULL DEFAULT 4,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX "qr_codes_workspaceId_idx" ON "qr_codes"("workspaceId");
CREATE INDEX "qr_codes_linkId_idx" ON "qr_codes"("linkId");
CREATE INDEX "qr_codes_createdById_idx" ON "qr_codes"("createdById");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_linkId_fkey"
    FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
