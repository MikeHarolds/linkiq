import type { PlanLimitKey } from '@prisma/client';
import { WebhookEventType } from '@prisma/client';

import type { BillingUsageService } from '../../billing/billing-usage.service';
import { PlanLimitExceededException } from '../../billing/exceptions/plan-limit-exceeded.exception';
import type { WebhookEventsService } from '../webhook-events.service';

/**
 * Thin wrapper around `BillingUsageService.assertCanUse` shared by every
 * creation call site that also needs to emit `billing.limit_reached`
 * (§7 of the Sprint 9 spec: "on throw -> billing.limit_reached"). Lives
 * here (not inside BillingUsageService itself) specifically so
 * BillingModule never has to import WebhooksModule back — WebhooksModule
 * already imports BillingModule for BillingUsageService, and a module
 * importing itself transitively would require forwardRef() for no real
 * benefit. This function is plain and has no NestJS module membership of
 * its own, so it introduces no such cycle: callers already depend on
 * both services directly.
 */
export async function assertCanUseOrEmitLimitReached(
  billingUsage: BillingUsageService,
  webhookEvents: WebhookEventsService,
  workspaceId: string,
  key: PlanLimitKey,
  featureLabel: string,
  amount = 1,
): Promise<void> {
  try {
    await billingUsage.assertCanUse(workspaceId, key, featureLabel, amount);
  } catch (error) {
    if (error instanceof PlanLimitExceededException) {
      const body = error.getResponse();
      await webhookEvents.emit({
        type: WebhookEventType.BILLING_LIMIT_REACHED,
        workspaceId,
        data:
          typeof body === 'object' && body !== null
            ? (body as Record<string, unknown>)
            : { feature: featureLabel },
      });
    }
    throw error;
  }
}
