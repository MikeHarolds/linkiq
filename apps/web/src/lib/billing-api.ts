import type {
  BillingSummaryDto,
  CheckoutCallbackResultDto,
  CurrencyDto,
  InvoiceDto,
  MyEntitlementDto,
  PlanDto,
  ProceedToPaymentResultDto,
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
export function getMyCurrencyPreference(): Promise<{
  currencyCode: string | null;
}> {
  return api.get('/users/me/currency-preference');
}

export function setMyCurrencyPreference(
  currency: string,
): Promise<CurrencyDto> {
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

/** Sprint 18A — `invoice` is non-null when a paid plan change requires
 * payment and a real payment provider is configured: a PENDING invoice
 * was created for review and nothing about the subscription has
 * changed. The caller shows an invoice-review screen and calls
 * proceedToPayment with `invoice.id` next. `checkoutUrl` (kept for
 * `cancel`/`reactivate`, which are unaffected by this sprint) is
 * non-null only for those older direct-checkout paths. Always both
 * null with no payment provider configured (dev mode) or when the
 * change never required payment (downgrade/lateral/trial). */
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

/** Sprint 18A, step 3 — the explicit "Proceed to Payment" action from
 * the invoice-review screen. Initializes a real Paystack transaction
 * against the given PENDING invoice's own stored currency/amount and
 * returns the authorization URL to redirect to. */
export function proceedToPayment(
  workspaceId: string,
  invoiceId: string,
): Promise<ProceedToPaymentResultDto> {
  return api.post<ProceedToPaymentResultDto>(
    `${basePath(workspaceId)}/invoices/${invoiceId}/pay`,
  );
}

/** The page the browser lands on after a redirect-based checkout.
 * Sprint 18A — independently re-verifies the transaction server-side
 * and, only on a verified success, activates the subscription; safe to
 * call repeatedly (idempotent). Never trust a redirect-back alone as
 * proof of payment — always call this. */
export function verifyCheckout(
  workspaceId: string,
  reference: string,
): Promise<CheckoutCallbackResultDto> {
  return api.get<CheckoutCallbackResultDto>(
    `${basePath(workspaceId)}/checkout/callback?reference=${encodeURIComponent(reference)}`,
  );
}
