import type {
  BillingSummaryDto,
  CheckoutCallbackResultDto,
  InvoiceDto,
  PlanDto,
  SubscriptionDto,
  SubscriptionMutationResultDto,
  UsageSnapshotDto,
} from '@linkiq/types';

import { api } from './api-client';

/** Nested under /workspaces/:workspaceId/billing — matches the API's own
 * routing, see apps/api/src/modules/billing/billing.controller.ts. */
function basePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/billing`;
}

export function getBillingSummary(
  workspaceId: string,
): Promise<BillingSummaryDto> {
  return api.get<BillingSummaryDto>(basePath(workspaceId));
}

export function getUsage(workspaceId: string): Promise<UsageSnapshotDto[]> {
  return api.get<UsageSnapshotDto[]>(`${basePath(workspaceId)}/usage`);
}

export function getPlans(workspaceId: string): Promise<PlanDto[]> {
  return api.get<PlanDto[]>(`${basePath(workspaceId)}/plans`);
}

export function getInvoices(workspaceId: string): Promise<InvoiceDto[]> {
  return api.get<InvoiceDto[]>(`${basePath(workspaceId)}/invoices`);
}

/** `checkoutUrl` is non-null when a real payment provider requires the
 * browser to complete payment before anything is applied — the caller
 * must redirect there instead of treating `subscription` as the new
 * state. Always null with no payment provider configured (dev mode). */
export function subscribe(
  workspaceId: string,
  planSlug: string,
): Promise<SubscriptionMutationResultDto> {
  return api.post<SubscriptionMutationResultDto>(
    `${basePath(workspaceId)}/subscribe`,
    {
      planSlug,
    },
  );
}

export function changePlan(
  workspaceId: string,
  planSlug: string,
): Promise<SubscriptionMutationResultDto> {
  return api.post<SubscriptionMutationResultDto>(
    `${basePath(workspaceId)}/change-plan`,
    {
      planSlug,
    },
  );
}

export function cancelSubscription(
  workspaceId: string,
): Promise<SubscriptionDto> {
  return api.post<SubscriptionDto>(`${basePath(workspaceId)}/cancel`);
}

export function reactivateSubscription(
  workspaceId: string,
): Promise<SubscriptionMutationResultDto> {
  return api.post<SubscriptionMutationResultDto>(
    `${basePath(workspaceId)}/reactivate`,
  );
}

/** Fast-path UX check for the page the browser lands on after a
 * redirect-based checkout. Read-only — the inbound webhook remains the
 * source of truth for actually activating the subscription. */
export function verifyCheckout(
  workspaceId: string,
  reference: string,
): Promise<CheckoutCallbackResultDto> {
  return api.get<CheckoutCallbackResultDto>(
    `${basePath(workspaceId)}/checkout/callback?reference=${encodeURIComponent(reference)}`,
  );
}
