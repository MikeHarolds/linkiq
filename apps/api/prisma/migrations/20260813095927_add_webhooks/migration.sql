-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('LINK_CREATED', 'LINK_UPDATED', 'LINK_DELETED', 'LINK_PAUSED', 'LINK_ACTIVATED', 'LINK_ARCHIVED', 'LINK_CLICKED', 'QRCODE_CREATED', 'QRCODE_UPDATED', 'QRCODE_DELETED', 'CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_DELETED', 'CAMPAIGN_ACTIVATED', 'CAMPAIGN_PAUSED', 'CAMPAIGN_ARCHIVED', 'DOMAIN_CREATED', 'DOMAIN_VERIFIED', 'DOMAIN_ACTIVATED', 'DOMAIN_DISABLED', 'DOMAIN_DELETED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_PLAN_CHANGED', 'SUBSCRIPTION_CANCELED', 'SUBSCRIPTION_REACTIVATED', 'BILLING_LIMIT_REACHED', 'API_KEY_CREATED', 'API_KEY_REVOKED', 'API_KEY_DELETED', 'WEBHOOK_TEST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApiKeyPermission" ADD VALUE 'WEBHOOKS_READ';
ALTER TYPE "ApiKeyPermission" ADD VALUE 'WEBHOOKS_WRITE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanLimitKey" ADD VALUE 'MAX_WEBHOOK_ENDPOINTS';
ALTER TYPE "PlanLimitKey" ADD VALUE 'MONTHLY_WEBHOOK_DELIVERIES';

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "events" "WebhookEventType"[],
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdById" UUID,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "type" "WebhookEventType" NOT NULL,
    "resourceId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhookEndpointId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" "WebhookEventType" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseTimeMs" INTEGER,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_workspaceId_idx" ON "webhook_endpoints"("workspaceId");

-- CreateIndex
CREATE INDEX "webhook_events_workspaceId_createdAt_idx" ON "webhook_events"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookEndpointId_createdAt_idx" ON "webhook_deliveries"("webhookEndpointId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_webhookEndpointId_eventId_key" ON "webhook_deliveries"("webhookEndpointId", "eventId");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookEndpointId_fkey" FOREIGN KEY ("webhookEndpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
