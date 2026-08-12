import { SubscriptionStatus } from '@prisma/client';

export interface SubscriptionStatusInput {
  status: SubscriptionStatus;
  trialEnd: Date | null;
  cancelAt: Date | null;
}

/**
 * Derives the subscription's true current status from its stored status
 * plus its date fields, without a background job ever having to flip a
 * column the instant a date passes — the same principle `LinkStatus`
 * (expiry) and `CampaignStatus` (COMPLETED via past `endDate`) already
 * use elsewhere in this codebase. Two transitions are derived here:
 *
 *   - TRIALING whose trialEnd has passed -> EXPIRED (the trial ran out
 *     without ever converting to a paid/free subscription).
 *   - Any status with a cancelAt that has passed -> CANCELED (the
 *     scheduled end-of-access date from a cancellation request has been
 *     reached — access continues normally right up until this moment,
 *     per the "cancel at end of billing period" requirement).
 *
 * Every other stored status (ACTIVE, PAST_DUE, PAUSED, and a CANCELED set
 * directly) passes through unchanged.
 */
export function getEffectiveStatus(
  subscription: SubscriptionStatusInput,
  now: Date = new Date(),
): SubscriptionStatus {
  if (
    subscription.status === SubscriptionStatus.TRIALING &&
    subscription.trialEnd &&
    subscription.trialEnd.getTime() < now.getTime()
  ) {
    return SubscriptionStatus.EXPIRED;
  }

  if (subscription.cancelAt && subscription.cancelAt.getTime() <= now.getTime()) {
    return SubscriptionStatus.CANCELED;
  }

  return subscription.status;
}

/**
 * True when the workspace should be treated as actively on its
 * subscribed plan (TRIALING/PAST_DUE both still grant the plan's limits —
 * a real provider integration would eventually move PAST_DUE to PAUSED or
 * CANCELED after a dunning grace period, not this sprint's concern).
 * False means BillingUsageService falls back to the FREE plan's limits —
 * never zero access, per the "existing usage must keep working" principle.
 */
export function isEffectivelyOnPlan(effectiveStatus: SubscriptionStatus): boolean {
  return (
    effectiveStatus === SubscriptionStatus.ACTIVE ||
    effectiveStatus === SubscriptionStatus.TRIALING ||
    effectiveStatus === SubscriptionStatus.PAST_DUE
  );
}
