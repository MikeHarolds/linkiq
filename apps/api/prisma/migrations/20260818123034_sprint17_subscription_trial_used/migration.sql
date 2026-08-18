-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "trialUsed" BOOLEAN NOT NULL DEFAULT false;

-- Sprint 17 data backfill — any subscription that has ever recorded a
-- trial window (trialStart set) or is currently TRIALING must not be
-- treated as trial-eligible again by the new payment-required logic in
-- SubscriptionsService.
UPDATE "subscriptions"
SET "trialUsed" = true
WHERE "trialStart" IS NOT NULL OR "status" = 'TRIALING';
