import type {
  BillingSummaryDto,
  InvoiceDto,
  PlanDto,
  SubscriptionDto,
  UsageSnapshotDto,
} from '@linkiq/types';

import { api } from './api-client';

/** Nested under /workspaces/:workspaceId/billing — matches the API's own
 * routing, see apps/api/src/modules/billing/billing.controller.ts. */
function basePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/billing`;
}

export function getBillingSummary(workspaceId: string): Promise<BillingSummaryDto> {
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

export function subscribe(
  workspaceId: string,
  planSlug: string,
): Promise<SubscriptionDto> {
  return api.post<SubscriptionDto>(`${basePath(workspaceId)}/subscribe`, {
    planSlug,
  });
}

export function changePlan(
  workspaceId: string,
  planSlug: string,
): Promise<SubscriptionDto> {
  return api.post<SubscriptionDto>(`${basePath(workspaceId)}/change-plan`, {
    planSlug,
  });
}

export function cancelSubscription(workspaceId: string): Promise<SubscriptionDto> {
  return api.post<SubscriptionDto>(`${basePath(workspaceId)}/cancel`);
}

export function reactivateSubscription(
  workspaceId: string,
): Promise<SubscriptionDto> {
  return api.post<SubscriptionDto>(`${basePath(workspaceId)}/reactivate`);
}
