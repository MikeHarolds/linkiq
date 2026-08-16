import type {
  BillingSummaryDto,
  CheckoutCallbackResultDto,
  CurrencyDto,
  InvoiceDto,
  MyEntitlementDto,
  PlanDto,
  SubscriptionDto,
  SubscriptionMutationResultDto,
  UsageSnapshotDto,
} from '@linkiq/types';

import { api } from './api-client';

/** Sprint 15 — not workspace-scoped (unlike everything else in this
 * file): the caller's own resolved platform role, shown alongside their
 * workspace's plan on the billing page per Part 19 of the sprint spec. */
export function getMyEntitlement(): Promise<MyEntitlementDto> {
  return api.get('/users/me/entitlement');
}

/** Sprint 16 — the authenticated user's persisted currency preference,
 * also not workspace-scoped (a user preference, not a workspace one). */
export function getMyCurrencyPreference(): Promise<{ currencyCode: string | null }> {
  return api.get('/users/me/currency-preference');
}

export function setMyCurrencyPreference(currency: string): Promise<CurrencyDto> {
  return api.patch('/users/me/currency-preference', { currency });
}

export function clearMyCurrencyPreference(): Promise<void> {
  return api.delete('/users/me/currency-preference');
}

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
 * state. Always null with no payment provider configured (dev mode).
 * `currency` (Sprint 16) is optional — omitted uses the plan's own
 * base currency, exactly as before this sprint. */
export function subscribe(
  workspaceId: string,
  planSlug: string,
  currency?: string,
): Promise<SubscriptionMutationResultDto> {
  return api.post<SubscriptionMutationResultDto>(
    `${basePath(workspaceId)}/subscribe`,
    {
      planSlug,
      currency,
    },
  );
}

export function changePlan(
  workspaceId: string,
  planSlug: string,
  currency?: string,
): Promise<SubscriptionMutationResultDto> {
  return api.post<SubscriptionMutationResultDto>(
    `${basePath(workspaceId)}/change-plan`,
    {
      planSlug,
      currency,
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
