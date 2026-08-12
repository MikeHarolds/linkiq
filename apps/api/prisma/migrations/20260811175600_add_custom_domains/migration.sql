-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFYING', 'VERIFIED', 'ACTIVE', 'FAILED', 'DISABLED');

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "click_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "feature_flags" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "link_daily_stats" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "links" ADD COLUMN     "customDomainId" UUID,
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "qr_codes" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspace_members" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspaces" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "custom_domains" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "normalizedDomain" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "verificationCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_domains_normalizedDomain_key" ON "custom_domains"("normalizedDomain");

-- CreateIndex
CREATE INDEX "custom_domains_workspaceId_idx" ON "custom_domains"("workspaceId");

-- CreateIndex
CREATE INDEX "custom_domains_workspaceId_isPrimary_idx" ON "custom_domains"("workspaceId", "isPrimary");

-- CreateIndex
CREATE INDEX "links_customDomainId_idx" ON "links"("customDomainId");

-- AddForeignKey
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_customDomainId_fkey" FOREIGN KEY ("customDomainId") REFERENCES "custom_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
