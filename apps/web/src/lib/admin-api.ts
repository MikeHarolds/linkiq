import type {
  AdminAuditLogDto,
  AdminCurrencyDto,
  AdminDomainListItemDto,
  AdminLandingPageContentDto,
  AdminSubscriptionListItemDto,
  AdminUserDetailDto,
  AdminUserListItemDto,
  AdminWebhookEndpointListItemDto,
  AdminWorkspaceDetailDto,
  AdminWorkspaceListItemDto,
  ApiUsageOverviewDto,
  AssignRolePayload,
  CreateCountryMappingPayload,
  CreateCurrencyPayload,
  CreatePlanPayload,
  CreateRolePayload,
  CurrencyCountryMappingDto,
  CurrencyDto,
  CurrencySettingsDto,
  DomainStatus,
  EmailConfigDto,
  EmailConnectionTestDto,
  EmailLogDto,
  EmailLogStatus,
  EmailLogType,
  EmailStatsDto,
  GlobalRole,
  InvoiceStatus,
  LandingPageFaqDto,
  LandingPageFeatureDto,
  LandingPageNavItemDto,
  LandingPageSectionDto,
  LandingPageSectionKey,
  LandingPageStatDto,
  Paginated,
  PaymentsSettingsDto,
  PaystackConnectionTestDto,
  PlanDto,
  PlatformOverviewDto,
  PlatformRoleDto,
  PlatformSettingsDto,
  SetPlanPricePayload,
  SiteBrandingDto,
  SubscriptionMutationResultDto,
  SubscriptionStatus,
  SubscriptionDto,
  SystemHealthDto,
  TimeRangeValue,
  UpdateCountryMappingPayload,
  UpdateCurrencyPayload,
  UpdateCurrencySettingsPayload,
  UpdateEmailConfigPayload,
  UpdateLandingPageSectionPayload,
  UpdatePlanPayload,
  UpdateRolePayload,
  UpsertLandingPageFaqPayload,
  UpsertLandingPageFeaturePayload,
  UpsertLandingPageNavItemPayload,
  UpsertLandingPageStatPayload,
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
export function getOverview(
  range: TimeRangeValue,
): Promise<PlatformOverviewDto> {
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
export function listUsers(
  params: ListUsersParams,
): Promise<Paginated<AdminUserListItemDto>> {
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
  return api.get(
    `${BASE}/users/${userId}/audit-activity${qs({ page, pageSize })}`,
  );
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
export function assignUserRole(userId: string, payload: AssignRolePayload) {
  return api.post(`${BASE}/users/${userId}/assign-role`, payload);
}
export function removeUserRoleOverride(userId: string) {
  return api.post(`${BASE}/users/${userId}/remove-role-override`);
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
export function getWorkspace(
  workspaceId: string,
): Promise<AdminWorkspaceDetailDto> {
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
  return api.post(`${BASE}/subscriptions/${workspaceId}/change-plan`, {
    planSlug,
  });
}
export function cancelWorkspaceSubscription(
  workspaceId: string,
): Promise<SubscriptionDto> {
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
  return api.post(`${BASE}/subscriptions/${workspaceId}/extend-trial`, {
    trialEnd,
  });
}

// --- Plans ---
export function listPlans(): Promise<PlanDto[]> {
  return api.get(`${BASE}/plans`);
}
export function getPlan(planId: string): Promise<PlanDto> {
  return api.get(`${BASE}/plans/${planId}`);
}
export function createPlan(payload: CreatePlanPayload): Promise<PlanDto> {
  return api.post(`${BASE}/plans`, payload);
}
export function updatePlan(
  planId: string,
  payload: UpdatePlanPayload,
): Promise<PlanDto> {
  return api.patch(`${BASE}/plans/${planId}`, payload);
}

// --- Plan currency pricing (Sprint 16) ---
export function setPlanPrice(
  planId: string,
  payload: SetPlanPricePayload,
): Promise<PlanDto> {
  return api.post(`${BASE}/plans/${planId}/prices`, payload);
}
export function removePlanPrice(
  planId: string,
  currencyId: string,
): Promise<PlanDto> {
  return api.delete(`${BASE}/plans/${planId}/prices/${currencyId}`);
}

// --- Roles (Sprint 15) ---
export function listRoles(): Promise<PlatformRoleDto[]> {
  return api.get(`${BASE}/roles`);
}
export function getRole(roleId: string): Promise<PlatformRoleDto> {
  return api.get(`${BASE}/roles/${roleId}`);
}
export function createRole(
  payload: CreateRolePayload,
): Promise<PlatformRoleDto> {
  return api.post(`${BASE}/roles`, payload);
}
export function updateRole(
  roleId: string,
  payload: UpdateRolePayload,
): Promise<PlatformRoleDto> {
  return api.patch(`${BASE}/roles/${roleId}`, payload);
}
export function deleteRole(roleId: string): Promise<{ success: boolean }> {
  return api.delete(`${BASE}/roles/${roleId}`);
}

// --- Currencies (Sprint 16) ---
export function listCurrencies(params?: {
  search?: string;
  isActive?: boolean;
  region?: string;
}): Promise<AdminCurrencyDto[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
  if (params?.region) query.set('region', params.region);
  const qs = query.toString();
  return api.get(`${BASE}/currencies${qs ? `?${qs}` : ''}`);
}
export function getCurrency(currencyId: string): Promise<CurrencyDto> {
  return api.get(`${BASE}/currencies/${currencyId}`);
}
export function createCurrency(payload: CreateCurrencyPayload): Promise<CurrencyDto> {
  return api.post(`${BASE}/currencies`, payload);
}
export function updateCurrency(
  currencyId: string,
  payload: UpdateCurrencyPayload,
): Promise<CurrencyDto> {
  return api.patch(`${BASE}/currencies/${currencyId}`, payload);
}
export function deleteCurrency(currencyId: string): Promise<{ success: boolean }> {
  return api.delete(`${BASE}/currencies/${currencyId}`);
}
export function getCurrencySettings(): Promise<CurrencySettingsDto> {
  return api.get(`${BASE}/currencies/settings`);
}
export function updateCurrencySettings(
  payload: UpdateCurrencySettingsPayload,
): Promise<CurrencySettingsDto> {
  return api.patch(`${BASE}/currencies/settings`, payload);
}
export function listCountryMappings(): Promise<CurrencyCountryMappingDto[]> {
  return api.get(`${BASE}/currencies/country-mappings`);
}
export function createCountryMapping(
  payload: CreateCountryMappingPayload,
): Promise<CurrencyCountryMappingDto> {
  return api.post(`${BASE}/currencies/country-mappings`, payload);
}
export function updateCountryMapping(
  mappingId: string,
  payload: UpdateCountryMappingPayload,
): Promise<CurrencyCountryMappingDto> {
  return api.patch(`${BASE}/currencies/country-mappings/${mappingId}`, payload);
}
export function deleteCountryMapping(mappingId: string): Promise<{ success: boolean }> {
  return api.delete(`${BASE}/currencies/country-mappings/${mappingId}`);
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
export function listPayments(
  params: ListInvoicesParams,
): Promise<Paginated<AdminInvoiceDto>> {
  return api.get(`${BASE}/payments${qs({ ...params })}`);
}
export function listInvoices(
  params: ListInvoicesParams,
): Promise<Paginated<AdminInvoiceDto>> {
  return api.get(`${BASE}/invoices${qs({ ...params })}`);
}
export function getInvoice(invoiceId: string): Promise<AdminInvoiceDto> {
  return api.get(`${BASE}/invoices/${invoiceId}`);
}

// --- API Usage ---
export function getApiUsageOverview(
  range: TimeRangeValue,
): Promise<ApiUsageOverviewDto> {
  return api.get(`${BASE}/api-usage${qs({ range })}`);
}

// --- Webhooks ---
export function getWebhookOpsOverview(
  range: TimeRangeValue,
): Promise<WebhookOpsOverviewDto> {
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
  return api.get(
    `${BASE}/webhooks/endpoints/${endpointId}/deliveries/${deliveryId}`,
  );
}
export function retryEndpointDelivery(
  endpointId: string,
  deliveryId: string,
): Promise<WebhookDeliveryDto> {
  return api.post(
    `${BASE}/webhooks/endpoints/${endpointId}/deliveries/${deliveryId}/retry`,
  );
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

// --- Landing Page CMS ---
export function getLandingPageContent(): Promise<AdminLandingPageContentDto> {
  return api.get(`${BASE}/landing-page`);
}
export function updateLandingPageSection(
  key: LandingPageSectionKey,
  payload: UpdateLandingPageSectionPayload,
): Promise<LandingPageSectionDto> {
  return api.patch(`${BASE}/landing-page/sections/${key}`, payload);
}

export function createFeature(
  payload: UpsertLandingPageFeaturePayload,
): Promise<LandingPageFeatureDto> {
  return api.post(`${BASE}/landing-page/features`, payload);
}
export function updateFeature(
  id: string,
  payload: Partial<UpsertLandingPageFeaturePayload>,
): Promise<LandingPageFeatureDto> {
  return api.patch(`${BASE}/landing-page/features/${id}`, payload);
}
export function deleteFeature(id: string): Promise<{ success: boolean }> {
  return api.delete(`${BASE}/landing-page/features/${id}`);
}
export function reorderFeatures(
  orderedIds: string[],
): Promise<{ success: boolean }> {
  return api.post(`${BASE}/landing-page/features/reorder`, { orderedIds });
}

export function createFaq(
  payload: UpsertLandingPageFaqPayload,
): Promise<LandingPageFaqDto> {
  return api.post(`${BASE}/landing-page/faqs`, payload);
}
export function updateFaq(
  id: string,
  payload: Partial<UpsertLandingPageFaqPayload>,
): Promise<LandingPageFaqDto> {
  return api.patch(`${BASE}/landing-page/faqs/${id}`, payload);
}
export function deleteFaq(id: string): Promise<{ success: boolean }> {
  return api.delete(`${BASE}/landing-page/faqs/${id}`);
}
export function reorderFaqs(
  orderedIds: string[],
): Promise<{ success: boolean }> {
  return api.post(`${BASE}/landing-page/faqs/reorder`, { orderedIds });
}

export function createStat(
  payload: UpsertLandingPageStatPayload,
): Promise<LandingPageStatDto> {
  return api.post(`${BASE}/landing-page/stats`, payload);
}
export function updateStat(
  id: string,
  payload: Partial<UpsertLandingPageStatPayload>,
): Promise<LandingPageStatDto> {
  return api.patch(`${BASE}/landing-page/stats/${id}`, payload);
}
export function deleteStat(id: string): Promise<{ success: boolean }> {
  return api.delete(`${BASE}/landing-page/stats/${id}`);
}
export function reorderStats(
  orderedIds: string[],
): Promise<{ success: boolean }> {
  return api.post(`${BASE}/landing-page/stats/reorder`, { orderedIds });
}

export function createNavItem(
  payload: UpsertLandingPageNavItemPayload,
): Promise<LandingPageNavItemDto> {
  return api.post(`${BASE}/landing-page/nav-items`, payload);
}
export function updateNavItem(
  id: string,
  payload: Partial<UpsertLandingPageNavItemPayload>,
): Promise<LandingPageNavItemDto> {
  return api.patch(`${BASE}/landing-page/nav-items/${id}`, payload);
}
export function deleteNavItem(id: string): Promise<{ success: boolean }> {
  return api.delete(`${BASE}/landing-page/nav-items/${id}`);
}
export function reorderNavItems(
  orderedIds: string[],
): Promise<{ success: boolean }> {
  return api.post(`${BASE}/landing-page/nav-items/reorder`, { orderedIds });
}

// --- Site Branding ---
export function getBranding(): Promise<SiteBrandingDto> {
  return api.get(`${BASE}/branding`);
}
export function updateBranding(siteName: string): Promise<SiteBrandingDto> {
  return api.patch(`${BASE}/branding`, { siteName });
}
export function uploadLogo(file: File): Promise<SiteBrandingDto> {
  const form = new FormData();
  form.append('file', file);
  return api.post(`${BASE}/branding/logo`, form);
}
export function removeLogo(): Promise<SiteBrandingDto> {
  return api.delete(`${BASE}/branding/logo`);
}
export function uploadFavicon(file: File): Promise<SiteBrandingDto> {
  const form = new FormData();
  form.append('file', file);
  return api.post(`${BASE}/branding/favicon`, form);
}
export function removeFavicon(): Promise<SiteBrandingDto> {
  return api.delete(`${BASE}/branding/favicon`);
}

// --- Email (Sprint 20) ---
export function getEmailConfig(): Promise<EmailConfigDto> {
  return api.get(`${BASE}/email/config`);
}
export function updateEmailConfig(
  payload: UpdateEmailConfigPayload,
): Promise<EmailConfigDto> {
  return api.patch(`${BASE}/email/config`, payload);
}
export function testEmailConnection(): Promise<EmailConnectionTestDto> {
  return api.post(`${BASE}/email/test-connection`);
}
export function sendTestEmail(to: string): Promise<{ message: string }> {
  return api.post(`${BASE}/email/send-test`, { to });
}
export interface ListEmailLogsParams {
  page: number;
  pageSize: number;
  status?: EmailLogStatus;
  type?: EmailLogType;
  recipientEmail?: string;
  dateFrom?: string;
  dateTo?: string;
}
export function listEmailLogs(
  params: ListEmailLogsParams,
): Promise<Paginated<EmailLogDto>> {
  return api.get(`${BASE}/email/logs${qs({ ...params })}`);
}
export function getEmailStats(range: TimeRangeValue): Promise<EmailStatsDto> {
  return api.get(`${BASE}/email/stats${qs({ range })}`);
}
