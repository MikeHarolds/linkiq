import type {
  AdminAuditLogDto,
  AdminDomainListItemDto,
  AdminSubscriptionListItemDto,
  AdminUserDetailDto,
  AdminUserListItemDto,
  AdminWebhookEndpointListItemDto,
  AdminWorkspaceDetailDto,
  AdminWorkspaceListItemDto,
  ApiUsageOverviewDto,
  DomainStatus,
  GlobalRole,
  InvoiceStatus,
  Paginated,
  PaymentsSettingsDto,
  PaystackConnectionTestDto,
  PlanDto,
  PlatformOverviewDto,
  PlatformSettingsDto,
  SubscriptionMutationResultDto,
  SubscriptionStatus,
  SubscriptionDto,
  SystemHealthDto,
  TimeRangeValue,
  UpdatePlanPayload,
  WebhookDeliveryDetailDto,
  WebhookDeliveryDto,
  WebhookDeliveryStatus,
  WebhookOpsOverviewDto,
  AdminInvoiceDto,
} from '@linkiq/types';

import { api } from './api-client';

const BASE = '/admin';

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

// --- Overview ---
export function getOverview(range: TimeRangeValue): Promise<PlatformOverviewDto> {
  return api.get<PlatformOverviewDto>(`${BASE}/overview${qs({ range })}`);
}

// --- Users ---
export interface ListUsersParams {
  page: number;
  pageSize: number;
  search?: string;
  globalRole?: GlobalRole;
  isActive?: 'true' | 'false';
}
export function listUsers(params: ListUsersParams): Promise<Paginated<AdminUserListItemDto>> {
  return api.get(`${BASE}/users${qs({ ...params })}`);
}
export function getUser(userId: string): Promise<AdminUserDetailDto> {
  return api.get(`${BASE}/users/${userId}`);
}
export function getUserAuditActivity(
  userId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<AdminAuditLogDto>> {
  return api.get(`${BASE}/users/${userId}/audit-activity${qs({ page, pageSize })}`);
}
export function suspendUser(userId: string): Promise<{ success: boolean }> {
  return api.post(`${BASE}/users/${userId}/suspend`);
}
export function reactivateUser(userId: string): Promise<{ success: boolean }> {
  return api.post(`${BASE}/users/${userId}/reactivate`);
}
export function forceLogoutUser(userId: string): Promise<{ success: boolean }> {
  return api.post(`${BASE}/users/${userId}/force-logout`);
}

// --- Workspaces ---
export interface ListWorkspacesParams {
  page: number;
  pageSize: number;
  search?: string;
  planSlug?: string;
}
export function listWorkspaces(
  params: ListWorkspacesParams,
): Promise<Paginated<AdminWorkspaceListItemDto>> {
  return api.get(`${BASE}/workspaces${qs({ ...params })}`);
}
export function getWorkspace(workspaceId: string): Promise<AdminWorkspaceDetailDto> {
  return api.get(`${BASE}/workspaces/${workspaceId}`);
}

// --- Subscriptions ---
export interface ListSubscriptionsParams {
  page: number;
  pageSize: number;
  status?: SubscriptionStatus;
  planSlug?: string;
  search?: string;
}
export function listSubscriptions(
  params: ListSubscriptionsParams,
): Promise<Paginated<AdminSubscriptionListItemDto>> {
  return api.get(`${BASE}/subscriptions${qs({ ...params })}`);
}
export function getWorkspaceInvoices(workspaceId: string) {
  return api.get(`${BASE}/subscriptions/${workspaceId}/invoices`);
}
export function changeWorkspacePlan(
  workspaceId: string,
  planSlug: string,
): Promise<SubscriptionMutationResultDto> {
  return api.post(`${BASE}/subscriptions/${workspaceId}/change-plan`, { planSlug });
}
export function cancelWorkspaceSubscription(workspaceId: string): Promise<SubscriptionDto> {
  return api.post(`${BASE}/subscriptions/${workspaceId}/cancel`);
}
export function reactivateWorkspaceSubscription(
  workspaceId: string,
): Promise<SubscriptionMutationResultDto> {
  return api.post(`${BASE}/subscriptions/${workspaceId}/reactivate`);
}
export function extendWorkspaceTrial(
  workspaceId: string,
  trialEnd: string,
): Promise<SubscriptionDto> {
  return api.post(`${BASE}/subscriptions/${workspaceId}/extend-trial`, { trialEnd });
}

// --- Plans ---
export function listPlans(): Promise<PlanDto[]> {
  return api.get(`${BASE}/plans`);
}
export function getPlan(planId: string): Promise<PlanDto> {
  return api.get(`${BASE}/plans/${planId}`);
}
export function updatePlan(planId: string, payload: UpdatePlanPayload): Promise<PlanDto> {
  return api.patch(`${BASE}/plans/${planId}`, payload);
}

// --- Payments & Invoices (same underlying data) ---
export interface ListInvoicesParams {
  page: number;
  pageSize: number;
  status?: InvoiceStatus;
  provider?: string;
  workspaceId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}
export function listPayments(params: ListInvoicesParams): Promise<Paginated<AdminInvoiceDto>> {
  return api.get(`${BASE}/payments${qs({ ...params })}`);
}
export function listInvoices(params: ListInvoicesParams): Promise<Paginated<AdminInvoiceDto>> {
  return api.get(`${BASE}/invoices${qs({ ...params })}`);
}
export function getInvoice(invoiceId: string): Promise<AdminInvoiceDto> {
  return api.get(`${BASE}/invoices/${invoiceId}`);
}

// --- API Usage ---
export function getApiUsageOverview(range: TimeRangeValue): Promise<ApiUsageOverviewDto> {
  return api.get(`${BASE}/api-usage${qs({ range })}`);
}

// --- Webhooks ---
export function getWebhookOpsOverview(range: TimeRangeValue): Promise<WebhookOpsOverviewDto> {
  return api.get(`${BASE}/webhooks/overview${qs({ range })}`);
}
export function listWebhookEndpoints(
  page: number,
  pageSize: number,
): Promise<Paginated<AdminWebhookEndpointListItemDto>> {
  return api.get(`${BASE}/webhooks/endpoints${qs({ page, pageSize })}`);
}
export function listEndpointDeliveries(
  endpointId: string,
  page: number,
  pageSize: number,
  status?: WebhookDeliveryStatus,
): Promise<Paginated<WebhookDeliveryDto>> {
  return api.get(
    `${BASE}/webhooks/endpoints/${endpointId}/deliveries${qs({ page, pageSize, status })}`,
  );
}
export function getEndpointDelivery(
  endpointId: string,
  deliveryId: string,
): Promise<WebhookDeliveryDetailDto> {
  return api.get(`${BASE}/webhooks/endpoints/${endpointId}/deliveries/${deliveryId}`);
}
export function retryEndpointDelivery(
  endpointId: string,
  deliveryId: string,
): Promise<WebhookDeliveryDto> {
  return api.post(`${BASE}/webhooks/endpoints/${endpointId}/deliveries/${deliveryId}/retry`);
}

// --- Domains ---
export interface ListDomainsParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: DomainStatus;
  workspaceId?: string;
}
export function listDomains(
  params: ListDomainsParams,
): Promise<Paginated<AdminDomainListItemDto>> {
  return api.get(`${BASE}/domains${qs({ ...params })}`);
}

// --- Audit logs ---
export interface ListAuditLogsParams {
  page: number;
  pageSize: number;
  userId?: string;
  workspaceId?: string;
  action?: string;
  entity?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}
export function listAuditLogs(
  params: ListAuditLogsParams,
): Promise<Paginated<AdminAuditLogDto>> {
  return api.get(`${BASE}/audit-logs${qs({ ...params })}`);
}

// --- Settings ---
export function getPlatformSettings(): Promise<PlatformSettingsDto> {
  return api.get(`${BASE}/settings`);
}
export function getPaymentsSettings(): Promise<PaymentsSettingsDto> {
  return api.get(`${BASE}/settings/payments`);
}
export function testPaystackConnection(): Promise<PaystackConnectionTestDto> {
  return api.post(`${BASE}/settings/payments/test-connection`);
}

// --- System health ---
export function getSystemHealth(): Promise<SystemHealthDto> {
  return api.get(`${BASE}/system-health`);
}
