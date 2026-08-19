/**
 * Shared TypeScript types/contracts between apps/web and apps/api.
 * Keep this package framework-agnostic (no Next.js or Nest imports).
 */

export type GlobalRole = 'SUPER_ADMIN' | 'USER';

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  globalRole: GlobalRole;
  emailVerified: boolean;
  createdAt: string;
}

export interface WorkspaceSummaryDto {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

export interface AuthResponseDto {
  accessToken: string;
  user: UserDto;
  workspaces: WorkspaceSummaryDto[];
}

export interface MeResponseDto {
  user: UserDto;
  workspaces: WorkspaceSummaryDto[];
}

export interface WorkspaceMemberDto {
  id: string;
  role: WorkspaceRole;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
  };
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

export type LinkStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface LinkDto {
  id: string;
  workspaceId: string;
  createdById: string | null;
  destinationUrl: string;
  shortCode: string;
  title: string | null;
  description: string | null;
  status: LinkStatus;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Custom-domain association (Sprint 6). Null for a link served from
   * the default LinkIQ host — see PublicUrlService on the API side. */
  customDomainId: string | null;
  customDomain: DomainDto | null;
  /** The link's resolved public URL — the active custom domain's host
   * if one is attached, else the default LinkIQ host. Always present. */
  publicUrl: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedLinksDto {
  items: LinkDto[];
  pagination: PaginationMeta;
}

export interface LinkStatsDto {
  totalLinks: number;
  activeLinks: number;
  pausedLinks: number;
  expiredLinks: number;
  archivedLinks: number;
  recentLinks: LinkDto[];
}

export type AnalyticsRange =
  'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';

export interface AnalyticsQueryParams {
  linkId?: string;
  range?: AnalyticsRange;
  from?: string;
  to?: string;
  timezone?: string;
  includeBots?: boolean;
}

export interface AnalyticsOverviewDto {
  totalClicks: number;
  humanClicks: number;
  botClicks: number;
  uniqueVisitors: number;
}

export interface AnalyticsTimeseriesPointDto {
  bucket: string;
  clicks: number;
}

export interface TopLinkDto {
  linkId: string;
  shortCode: string;
  title: string | null;
  clicks: number;
}

export interface ReferrerDto {
  domain: string;
  category: string;
  clicks: number;
}

export interface CountryStatDto {
  country: string;
  clicks: number;
}

export interface RegionStatDto {
  region: string;
  clicks: number;
}

export interface GeographyDto {
  countries: CountryStatDto[];
  regions: RegionStatDto[];
}

export interface BreakdownItemDto {
  value: string;
  clicks: number;
}

export type QrFormat = 'PNG' | 'SVG';
export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrCodeDto {
  id: string;
  workspaceId: string;
  linkId: string;
  name: string;
  format: QrFormat;
  size: number;
  foregroundColor: string;
  backgroundColor: string;
  errorCorrectionLevel: QrErrorCorrectionLevel;
  margin: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Present only on the workspace-wide list endpoint, which includes it
   * for display (short code, title) without a separate lookup per row. */
  link?: {
    id: string;
    shortCode: string;
    title: string | null;
  };
}

export interface PaginatedQrCodesDto {
  items: QrCodeDto[];
  pagination: PaginationMeta;
}

export type CampaignStatus =
  'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

export interface UtmDefaults {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

export interface CampaignDto extends UtmDefaults {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CampaignListItemDto extends CampaignDto {
  linkCount: number;
}

export interface PaginatedCampaignsDto {
  items: CampaignListItemDto[];
  pagination: PaginationMeta;
}

export interface CampaignLinkDto extends LinkDto {
  qrCodes: { id: string; linkId: string; name: string; format: QrFormat }[];
}

export interface CampaignAnalyticsDto {
  overview: AnalyticsOverviewDto;
  clickTrend: AnalyticsTimeseriesPointDto[];
  topLinks: TopLinkDto[];
  topSources: BreakdownItemDto[];
  topMediums: BreakdownItemDto[];
  topCountries: BreakdownItemDto[];
  devices: BreakdownItemDto[];
  referrers: BreakdownItemDto[];
}

export type DomainStatus =
  'PENDING' | 'VERIFYING' | 'VERIFIED' | 'ACTIVE' | 'FAILED' | 'DISABLED';

export interface DomainVerificationInstructions {
  recordName: string;
  recordType: 'TXT';
  recordValue: string;
}

export interface DomainDto {
  id: string;
  workspaceId: string;
  domain: string;
  normalizedDomain: string;
  status: DomainStatus;
  verificationToken: string;
  verificationCheckedAt: string | null;
  verifiedAt: string | null;
  isPrimary: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived, not stored — the exact DNS TXT record the user must
   * publish, matching the domain's current verificationToken. */
  verification: DomainVerificationInstructions;
}

export interface PaginatedDomainsDto {
  items: DomainDto[];
  pagination: PaginationMeta;
}

export interface CreateDomainPayload {
  domain: string;
}

export interface UpdateDomainPayload {
  domain?: string;
}

export type PlanTier =
  'FREE' | 'STARTER' | 'PROFESSIONAL' | 'BUSINESS' | 'ENTERPRISE';

export type BillingInterval = 'MONTHLY' | 'ANNUAL';

export type PlanLimitKey =
  | 'MAX_LINKS'
  | 'MAX_QR_CODES'
  | 'MAX_CAMPAIGNS'
  | 'MAX_CUSTOM_DOMAINS'
  | 'MAX_TEAM_MEMBERS'
  | 'MONTHLY_CLICKS'
  | 'ANALYTICS_RETENTION_DAYS'
  | 'MONTHLY_API_REQUESTS'
  | 'MAX_WEBHOOK_ENDPOINTS'
  | 'MONTHLY_WEBHOOK_DELIVERIES';

export type SubscriptionStatus =
  'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';

export type InvoiceStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'PAID'
  | 'VOID'
  | 'UNCOLLECTIBLE'
  | 'REFUNDED'
  /** Sprint 18A — a checkout invoice awaiting payment. */
  | 'PENDING'
  /** Sprint 18A — a checkout invoice whose payment was confirmed
   * unsuccessful (or failed independent verification). Terminal. */
  | 'FAILED';

export interface PlanLimitDto {
  key: PlanLimitKey;
  /** null = unlimited. */
  value: number | null;
}

/** Sprint 16 — one of a plan's additional currency-specific prices,
 * beyond its base `currency`/`priceAmount`. */
export interface PlanPriceDto {
  currencyCode: string;
  /** Smallest currency unit. */
  amount: number;
  isConverted: boolean;
  /** Whether the currently-configured payment provider can actually
   * process a charge in this currency — distinct from the currency
   * being active in LinkIQ's own catalogue (see Sprint 16 §11). */
  providerAvailable: boolean;
}

export interface PlanDto {
  id: string;
  name: string;
  slug: string;
  tier: PlanTier;
  description: string | null;
  /** Smallest currency unit (cents). */
  priceAmount: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number | null;
  isActive: boolean;
  displayOrder: number;
  limits: PlanLimitDto[];
  providerPlanId: string | null;
  /** Sprint 15 — the platform role a workspace's OWNER holds while this
   * plan is effectively active on a workspace they own, if any. */
  platformRole: { id: string; name: string; slug: string } | null;
  /** Sprint 16 — additional currency-specific prices; empty when the
   * plan is only priced in its base currency. */
  prices: PlanPriceDto[];
  /** Sprint 16 — whether the base `currency` above is processable by
   * the configured payment provider. */
  providerAvailable: boolean;
  /** Sprint 17 — whether this plan is included in the public marketing
   * pricing section (see PublicController.getPlans). Independent of
   * `isActive` — a plan can stay purchasable from the dashboard while
   * excluded from the homepage. */
  isFeaturedOnHomepage: boolean;
  /** Sort position among featured plans on the homepage; null = falls
   * back to `displayOrder`. */
  homepageOrder: number | null;
}

export interface UsageSnapshotDto {
  key: PlanLimitKey;
  usage: number;
  /** null = unlimited. */
  limit: number | null;
  /** null = unlimited. */
  remaining: number | null;
  unlimited: boolean;
}

export interface SubscriptionDto {
  id: string;
  workspaceId: string;
  /** The stored status — see `effectiveStatus` for the derived value
   * that reflects an expired trial or a reached cancellation date. */
  status: SubscriptionStatus;
  effectiveStatus: SubscriptionStatus;
  plan: PlanDto;
  /** Sprint 16 — the currency/amount THIS subscription actually
   * applies in, set once at subscribe/checkout time and never silently
   * changed by a later currency preference change or plan price edit
   * (see Sprint 16 §12). */
  currency: string;
  amount: number;
  billingPeriod: { start: string; end: string | null };
  trial: { start: string | null; end: string | null } | null;
  cancellation: { cancelAt: string; canceledAt: string | null } | null;
  provider: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingSummaryDto {
  subscription: SubscriptionDto | null;
  plan: PlanDto;
  usage: UsageSnapshotDto[];
  invoiceCount: number;
  /** Sprint 17 — the currently configured payment gateway's machine
   * name (e.g. "paystack"), or null when none is configured (dev
   * mode). Drives the checkout confirmation UI's gateway display —
   * never a hardcoded frontend string. */
  activeProvider: string | null;
}

/**
 * subscribe/change-plan/reactivate all return this shape (Sprint 10).
 * `checkoutUrl` non-null means the frontend must redirect there instead
 * of treating `subscription` as the new state — nothing has been
 * applied yet, the inbound provider webhook is what actually activates
 * it. `cancel` still returns a bare SubscriptionDto (never produces a
 * checkout).
 */
/** Sprint 18A — non-null exactly when a paid plan change required
 * payment and a real payment provider is configured: a PENDING invoice
 * was created for review and `checkoutUrl` is null (nothing about the
 * subscription has changed). The frontend shows an invoice-review
 * screen and calls POST .../invoices/:id/pay next. */
export interface SubscriptionMutationResultDto extends SubscriptionDto {
  checkoutUrl: string | null;
  invoice: InvoiceDto | null;
}

export interface CheckoutCallbackResultDto {
  success: boolean;
  invoice: InvoiceDto | null;
  subscription: SubscriptionDto | null;
}

export interface ProceedToPaymentResultDto {
  checkoutUrl: string;
}

export interface InvoiceDto {
  id: string;
  workspaceId: string;
  subscriptionId: string | null;
  /** Sprint 18A — the plan a PENDING/in-flight invoice's checkout is
   * FOR; null for invoices predating this field. */
  targetPlanId: string | null;
  /** Sprint 18B — the same plan, resolved to a display name/slug so
   * the customer invoice center and admin invoice list never have to
   * make a second lookup just to show "which plan was this for." Null
   * exactly when targetPlanId is null. */
  targetPlan: { id: string; name: string; slug: string } | null;
  number: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string | null;
  paidAt: string | null;
  provider: string | null;
  providerInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  /** Sprint 18B — the subscription billing period this invoice paid
   * for, snapshotted at the moment it was marked PAID. Null for a
   * PENDING/FAILED invoice, or one that predates this field. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Sprint 16 — set only when `amount`/`currency` were produced via
   * exchange-rate conversion rather than a fixed price. Historical —
   * never recomputed after the fact. */
  exchangeRate: string | null;
  exchangeRateAsOf: string | null;
}

/** Structured billing/limit error body — see
 * docs/architecture/billing.md §Limit enforcement. Distinguishes a
 * plan-limit rejection from a generic 403 so the frontend can show an
 * upgrade prompt instead of a plain error toast. */
export interface PlanLimitReachedError {
  code: 'PLAN_LIMIT_REACHED';
  feature: string;
  limit: number;
  usage: number;
  remaining: number;
  message: string;
}

// ---------------------------------------------------------------------
// API Keys & Developer API (Sprint 8)
// ---------------------------------------------------------------------

export type ApiKeyPermission =
  | 'LINKS_READ'
  | 'LINKS_WRITE'
  | 'CAMPAIGNS_READ'
  | 'CAMPAIGNS_WRITE'
  | 'QRCODES_READ'
  | 'QRCODES_WRITE'
  | 'ANALYTICS_READ'
  | 'DOMAINS_READ'
  | 'DOMAINS_WRITE'
  | 'WORKSPACE_READ'
  | 'WEBHOOKS_READ'
  | 'WEBHOOKS_WRITE';

/** Derived, not stored — see docs/architecture/api-keys.md. */
export type ApiKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ApiKeyDto {
  id: string;
  workspaceId: string;
  name: string;
  /** Safe to display, e.g. "lk_live_ab12cd34" — never the full secret. */
  keyPrefix: string;
  permissions: ApiKeyPermission[];
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Only the create response ever carries `key` — the full secret, shown
 * exactly once. Every other read of an API key returns ApiKeyDto. */
export interface CreatedApiKeyDto extends ApiKeyDto {
  key: string;
}

export interface CreateApiKeyPayload {
  name: string;
  /** Explicit, non-empty — there is no implicit "all access" default. */
  permissions: ApiKeyPermission[];
  expiresAt?: string;
}

/** Structured API-auth/authorization error bodies — see
 * docs/architecture/api-keys.md §Errors. Each `code` maps to exactly one
 * of these shapes; the frontend can switch on `code` to show a tailored
 * message instead of a generic error toast. */
export interface InvalidApiKeyError {
  code: 'INVALID_API_KEY' | 'API_KEY_REVOKED' | 'API_KEY_EXPIRED';
  message: string;
}

export interface ApiPermissionDeniedError {
  code: 'API_PERMISSION_DENIED';
  permission: string;
  message: string;
}

export interface WorkspaceAccessDeniedError {
  code: 'WORKSPACE_ACCESS_DENIED';
  message: string;
}

export interface ApiPlanLimitReachedError {
  code: 'API_PLAN_LIMIT_REACHED';
  feature: string;
  limit: number;
  usage: number;
  remaining: number;
  message: string;
}

export interface ApiRateLimitExceededError {
  code: 'API_RATE_LIMIT_EXCEEDED';
  message: string;
}

// ---------------------------------------------------------------------
// Webhooks & Event Delivery (Sprint 9)
// ---------------------------------------------------------------------

/** Dotted wire-format event type strings — see event-catalog.ts (the
 * source of truth) and docs/api/webhooks.md's full event catalog table.
 * `webhook.test` is deliberately excluded: it is never subscribable,
 * only ever sent by the "send test event" action. */
export type WebhookEventTypeName =
  | 'link.created'
  | 'link.updated'
  | 'link.deleted'
  | 'link.paused'
  | 'link.activated'
  | 'link.archived'
  | 'link.clicked'
  | 'qrcode.created'
  | 'qrcode.updated'
  | 'qrcode.deleted'
  | 'campaign.created'
  | 'campaign.updated'
  | 'campaign.deleted'
  | 'campaign.activated'
  | 'campaign.paused'
  | 'campaign.archived'
  | 'domain.created'
  | 'domain.verified'
  | 'domain.activated'
  | 'domain.disabled'
  | 'domain.deleted'
  | 'subscription.created'
  | 'subscription.plan_changed'
  | 'subscription.canceled'
  | 'subscription.reactivated'
  | 'billing.limit_reached'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'api_key.deleted';

export type WebhookEndpointStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

export type WebhookDeliveryStatus =
  'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'EXHAUSTED';

export interface WebhookEndpointDto {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  /** Safe to display, e.g. "whsec_ab12cd34" — never the full secret. */
  secretPrefix: string;
  events: WebhookEventTypeName[];
  status: WebhookEndpointStatus;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Only create and rotate-secret responses ever carry `secret` — the
 * full signing secret, shown exactly once. Every other read returns
 * WebhookEndpointDto. */
export interface CreatedWebhookEndpointDto extends WebhookEndpointDto {
  secret: string;
}

export interface CreateWebhookEndpointPayload {
  name: string;
  url: string;
  /** Explicit, non-empty — there is no implicit "subscribe to everything". */
  events: WebhookEventTypeName[];
}

export interface UpdateWebhookEndpointPayload {
  name?: string;
  url?: string;
  events?: WebhookEventTypeName[];
}

export interface WebhookDeliveryDto {
  id: string;
  webhookEndpointId: string;
  eventId: string;
  eventType: WebhookEventTypeName;
  attemptCount: number;
  status: WebhookDeliveryStatus;
  responseStatus: number | null;
  responseTimeMs: number | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned only by the single-delivery detail endpoint — includes the
 * event envelope for inspection, still never the endpoint's secret. */
export interface WebhookDeliveryDetailDto extends WebhookDeliveryDto {
  event: {
    id: string;
    type: WebhookEventTypeName | 'webhook.test';
    createdAt: string;
    data: Record<string, unknown>;
  };
}

/** The exact JSON body signed and POSTed to every webhook endpoint. */
export interface WebhookEventEnvelope {
  id: string;
  type: WebhookEventTypeName | 'webhook.test';
  createdAt: string;
  workspaceId: string;
  data: Record<string, unknown>;
}

// --- Platform Administration / Super Admin (Sprint 11) ---

/** Generic paginated-list shape for the new admin endpoints — every
 * pre-Sprint-11 resource used its own `Paginated<X>Dto` name instead;
 * this one is shared since all admin list types are new together. */
export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export type TimeRangeValue = 'today' | '7d' | '30d' | '90d';

export interface PlatformOverviewDto {
  users: { total: number; active: number };
  workspaces: { total: number };
  links: { active: number };
  clicks: { inRange: number };
  subscriptions: { active: number; trialing: number; pastDue: number };
  mrr: { amount: number; currency: string | null; note: string | null };
  revenue: { collectedInRange: number; currency: string | null };
  paymentFailures: { inRange: number };
  apiRequests: { inRange: number };
  webhookFailures: { inRange: number };
  domains: { total: number; active: number };
}

export interface AdminUserListItemDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  globalRole: GlobalRole;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  workspaceCount: number;
  lastLoginAt: string | null;
  /** Sprint 15 */
  platformRole: { id: string; name: string; slug: string } | null;
  roleAssignmentSource: RoleAssignmentSource | null;
}

export interface AdminUserDetailDto extends AdminUserListItemDto {
  updatedAt: string;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: WorkspaceRole;
    planName: string | null;
    planSlug: string | null;
    subscriptionStatus: string | null;
  }>;
}

export interface AdminAuditLogDto {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  metadata: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  workspace: { id: string; name: string; slug: string } | null;
}

export interface AdminWorkspaceListItemDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  organizationName: string;
  owner: { id: string; email: string; firstName: string; lastName: string };
  memberCount: number;
  linkCount: number;
  domainCount: number;
  planName: string | null;
  planSlug: string | null;
  subscriptionStatus: string | null;
}

export interface AdminWorkspaceDetailDto extends AdminWorkspaceListItemDto {
  members: Array<{
    id: string;
    role: WorkspaceRole;
    user: { id: string; email: string; firstName: string; lastName: string };
  }>;
  subscription: SubscriptionDto | null;
  usage: UsageSnapshotDto[];
  domains: Array<{
    id: string;
    domain: string;
    status: DomainStatus;
    isPrimary: boolean;
  }>;
  apiKeys: ApiKeyDto[];
  webhookEndpoints: Array<{
    id: string;
    name: string;
    url: string;
    status: WebhookEndpointStatus;
  }>;
  recentAudit: AdminAuditLogDto[];
}

/** Raw-shaped (not the customer-facing computed SubscriptionDto — no
 * derived effectiveStatus/billingPeriod/trial/cancellation grouping,
 * just the underlying Subscription row plus its plan and workspace) —
 * sufficient for the admin table/detail views without importing
 * billing.controller.ts's private response-shaping helpers. */
export interface AdminSubscriptionListItemDto {
  id: string;
  workspaceId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  cancelAt: string | null;
  canceledAt: string | null;
  pastDueSince: string | null;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerPriceId: string | null;
  createdAt: string;
  updatedAt: string;
  plan: PlanDto;
  workspace: {
    id: string;
    name: string;
    slug: string;
    organization: {
      name: string;
      owner: { id: string; email: string; firstName: string; lastName: string };
    };
  };
}

export interface AdminInvoiceDto extends InvoiceDto {
  failureReason: string | null;
  workspace: { id: string; name: string; slug: string };
}

export interface PlatformSettingsDto {
  billingProvider: string;
  webhooks: {
    maxAttempts: number;
    backoffBaseMs: number;
    autoDisableThreshold: number;
  };
  domainVerificationMode: string;
}

export interface PaymentsSettingsDto {
  provider: string;
  secretKeyConfigured: boolean;
  publicKeyConfigured: boolean;
  mode: 'test' | 'live' | 'unknown';
  pastDueGraceDays: number;
  apiBaseUrl: string;
}

export interface PaystackConnectionTestDto {
  connected: boolean;
  message: string;
}

export interface ApiUsageOverviewDto {
  totalRequests: number;
  failedRequests: number;
  activeApiKeys: number;
  requestsOverTime: Array<{ date: string; count: number }>;
  topWorkspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    requests: number;
  }>;
}

export interface WebhookOpsOverviewDto {
  endpointCount: number;
  activeEndpointCount: number;
  deliveriesByStatus: Record<WebhookDeliveryStatus, number>;
  successRate: number | null;
  recentEvents: Array<{
    id: string;
    type: string;
    workspaceId: string;
    workspaceName: string;
    createdAt: string;
  }>;
}

export interface AdminWebhookEndpointListItemDto {
  id: string;
  name: string;
  url: string;
  status: WebhookEndpointStatus;
  workspaceId: string;
  workspaceName: string;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
}

export interface AdminDomainListItemDto {
  id: string;
  workspaceId: string;
  domain: string;
  normalizedDomain: string;
  status: DomainStatus;
  isPrimary: boolean;
  verifiedAt: string | null;
  verificationCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workspace: { id: string; name: string; slug: string };
}

export interface UpdatePlanPayload {
  name?: string;
  description?: string | null;
  priceAmount?: number;
  currency?: string;
  billingInterval?: BillingInterval;
  trialDays?: number | null;
  isActive?: boolean;
  displayOrder?: number;
  providerPlanId?: string | null;
  limits?: Partial<Record<PlanLimitKey, number | null>>;
  platformRoleId?: string | null;
  isFeaturedOnHomepage?: boolean;
  homepageOrder?: number | null;
}

export interface SystemHealthDto {
  status: 'ok' | 'error';
  info?: Record<string, { status: string; [key: string]: unknown }>;
  error?: Record<string, { status: string; [key: string]: unknown }>;
  details: Record<string, { status: string; [key: string]: unknown }>;
  paystack: PaystackConnectionTestDto;
}

export interface CreatePlanPayload {
  name: string;
  slug: string;
  tier: PlanTier;
  description?: string | null;
  priceAmount: number;
  currency?: string;
  billingInterval?: BillingInterval;
  trialDays?: number | null;
  isActive?: boolean;
  displayOrder?: number;
  providerPlanId?: string | null;
  limits?: Partial<Record<PlanLimitKey, number | null>>;
  /** When true, and the active BillingProvider supports it (Paystack
   * does), also creates a matching plan on the provider side and
   * stores the resulting code as providerPlanId. Silently skipped
   * (never fails plan creation) if the provider doesn't support it or
   * the call fails — see BillingProvider.createProviderPlan. */
  syncToProvider?: boolean;
  /** Sprint 15 — the platform role a workspace's OWNER holds while this
   * plan is effectively active on a workspace they own. */
  platformRoleId?: string | null;
  isFeaturedOnHomepage?: boolean;
  homepageOrder?: number | null;
}

// ---------------------------------------------------------------------------
// Landing Page CMS & Site Branding (Sprint 14)
// ---------------------------------------------------------------------------

export type LandingPageSectionKey =
  | 'HERO'
  | 'STATS'
  | 'FEATURES'
  | 'PRODUCT_SHOWCASE'
  | 'CUSTOM_DOMAINS'
  | 'DEVELOPERS'
  | 'PRICING'
  | 'FAQ'
  | 'CTA';

export type LandingPageNavPlacement =
  'HEADER' | 'FOOTER_PRODUCT' | 'FOOTER_DEVELOPERS' | 'FOOTER_COMPANY';

/** Curated, deliberately finite set of lucide-react icon names an admin
 * may attach to a feature/stat — never free-text, so content can never
 * inject arbitrary markup via this field. Keep in sync with
 * apps/web/src/components/marketing/icon-map.ts's lookup object. */
export const LANDING_PAGE_ICON_KEYS = [
  'Link2',
  'BarChart3',
  'Globe2',
  'Webhook',
  'Users',
  'Zap',
  'ShieldCheck',
  'Terminal',
  'Lock',
  'Shield',
  'Rocket',
  'Sparkles',
  'Database',
  'Code',
  'Cloud',
  'Smartphone',
  'Mail',
  'Bell',
  'Search',
  'Star',
  'CheckCircle2',
  'TrendingUp',
  'Activity',
  'MousePointerClick',
  'QrCode',
  'Settings',
  'Layers',
  'KeyRound',
] as const;
export type LandingPageIconKey = (typeof LANDING_PAGE_ICON_KEYS)[number];

export interface LandingPageSectionDto {
  id: string;
  key: LandingPageSectionKey;
  isActive: boolean;
  eyebrow: string | null;
  headline: string | null;
  description: string | null;
  primaryCtaText: string | null;
  primaryCtaUrl: string | null;
  secondaryCtaText: string | null;
  secondaryCtaUrl: string | null;
  updatedAt: string;
}

export interface UpdateLandingPageSectionPayload {
  isActive?: boolean;
  eyebrow?: string | null;
  headline?: string | null;
  description?: string | null;
  primaryCtaText?: string | null;
  primaryCtaUrl?: string | null;
  secondaryCtaText?: string | null;
  secondaryCtaUrl?: string | null;
}

export interface LandingPageFeatureDto {
  id: string;
  title: string;
  description: string;
  icon: LandingPageIconKey;
  sortOrder: number;
  isActive: boolean;
}

export interface UpsertLandingPageFeaturePayload {
  title: string;
  description: string;
  icon: LandingPageIconKey;
  isActive?: boolean;
}

export interface LandingPageFaqDto {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UpsertLandingPageFaqPayload {
  question: string;
  answer: string;
  isActive?: boolean;
}

export interface LandingPageStatDto {
  id: string;
  label: string;
  sublabel: string | null;
  icon: LandingPageIconKey;
  sortOrder: number;
  isActive: boolean;
}

export interface UpsertLandingPageStatPayload {
  label: string;
  sublabel?: string | null;
  icon: LandingPageIconKey;
  isActive?: boolean;
}

export interface LandingPageNavItemDto {
  id: string;
  placement: LandingPageNavPlacement;
  label: string;
  url: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UpsertLandingPageNavItemPayload {
  placement: LandingPageNavPlacement;
  label: string;
  url: string;
  isActive?: boolean;
}

export interface ReorderPayload {
  /** The full set of ids for this resource, in the desired display
   * order — sortOrder is reassigned sequentially from this array. */
  orderedIds: string[];
}

/** Admin view — every section (including inactive) plus every
 * repeatable content list (including inactive rows), for the CMS
 * editor. Contrast with PublicLandingPageContentDto, which only ever
 * includes active content. */
export interface AdminLandingPageContentDto {
  sections: LandingPageSectionDto[];
  features: LandingPageFeatureDto[];
  faqs: LandingPageFaqDto[];
  stats: LandingPageStatDto[];
  navItems: LandingPageNavItemDto[];
}

/** Public view — only active sections/rows, already sorted, ready to
 * render directly. Never includes ids/timestamps the public page has
 * no use for beyond what's listed here. */
export interface PublicLandingPageContentDto {
  sections: Array<Omit<LandingPageSectionDto, 'id' | 'isActive' | 'updatedAt'>>;
  features: Array<Omit<LandingPageFeatureDto, 'id' | 'isActive' | 'sortOrder'>>;
  faqs: Array<Omit<LandingPageFaqDto, 'id' | 'isActive' | 'sortOrder'>>;
  stats: Array<Omit<LandingPageStatDto, 'id' | 'isActive' | 'sortOrder'>>;
  navItems: {
    header: Array<
      Omit<LandingPageNavItemDto, 'id' | 'isActive' | 'sortOrder' | 'placement'>
    >;
    footerProduct: Array<
      Omit<LandingPageNavItemDto, 'id' | 'isActive' | 'sortOrder' | 'placement'>
    >;
    footerDevelopers: Array<
      Omit<LandingPageNavItemDto, 'id' | 'isActive' | 'sortOrder' | 'placement'>
    >;
    footerCompany: Array<
      Omit<LandingPageNavItemDto, 'id' | 'isActive' | 'sortOrder' | 'placement'>
    >;
  };
}

export interface SiteBrandingDto {
  siteName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  updatedAt: string;
}

/** Public view — deliberately just the 3 fields the marketing site /
 * auth pages need. Never the admin's full SiteBrandingDto verbatim, so
 * this type is the enforced boundary against accidentally widening the
 * public endpoint later. */
export interface PublicSiteConfigDto {
  siteName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

export interface UpdateSiteBrandingPayload {
  siteName?: string;
}

/** The marketing pricing section's data source — a deliberately
 * narrower view of PlanDto (no providerPlanId, no isActive — this
 * list is already filtered to active-only) for the public,
 * unauthenticated /public/plans endpoint. */
export interface PublicPlanDto {
  id: string;
  name: string;
  slug: string;
  tier: PlanTier;
  description: string | null;
  priceAmount: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number | null;
  displayOrder: number;
  limits: Array<{ key: PlanLimitKey; value: number | null }>;
  /** Sprint 16 — additional currency-specific prices for the pricing
   * page's currency selector. */
  prices: Array<{ currencyCode: string; amount: number }>;
}

// ---------------------------------------------------------------------------
// Platform Roles & Permissions (Sprint 15)
// ---------------------------------------------------------------------------

/** Fixed, typed permission keys — never arbitrary strings. Every key
 * corresponds to a module that genuinely exists in LinkIQ. Keep in sync
 * with apps/api's PermissionKey Prisma enum (documented cross-boundary
 * duplication, same convention as PlanLimitKey/LandingPageIconKey). */
export const PERMISSION_KEYS = [
  'LINKS_VIEW',
  'LINKS_CREATE',
  'LINKS_EDIT',
  'LINKS_DELETE',
  'ANALYTICS_VIEW',
  'ANALYTICS_ADVANCED',
  'DOMAINS_VIEW',
  'DOMAINS_CREATE',
  'DOMAINS_DELETE',
  'QR_CODES_VIEW',
  'QR_CODES_CREATE',
  'QR_CODES_DELETE',
  'CAMPAIGNS_VIEW',
  'CAMPAIGNS_CREATE',
  'CAMPAIGNS_EDIT',
  'CAMPAIGNS_DELETE',
  'API_VIEW',
  'API_CREATE',
  'API_REVOKE',
  'WEBHOOKS_VIEW',
  'WEBHOOKS_CREATE',
  'WEBHOOKS_EDIT',
  'WEBHOOKS_DELETE',
  'BILLING_VIEW',
  'BILLING_MANAGE',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type RoleAssignmentSource =
  'SUBSCRIPTION' | 'ADMIN_ASSIGNED' | 'SYSTEM_DEFAULT';

export interface PlatformRoleDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: PermissionKey[];
  userCount: number;
  plans: Array<{ id: string; name: string; slug: string }>;
}

export interface CreateRolePayload {
  name: string;
  slug: string;
  description?: string;
  permissions?: PermissionKey[];
  isActive?: boolean;
}

export interface UpdateRolePayload {
  name?: string;
  description?: string;
  permissions?: PermissionKey[];
  isActive?: boolean;
}

export interface AssignRolePayload {
  platformRoleId: string;
}

/** GET /users/me/entitlement — the authenticated user's own resolved
 * role, why they have it, and what it currently grants. */
export interface MyEntitlementDto {
  role: string | null;
  source: RoleAssignmentSource;
  permissions: PermissionKey[];
}

// ---------------------------------------------------------------------------
// Currency, Localization & Multi-Currency Payments (Sprint 16)
// ---------------------------------------------------------------------------

export interface CurrencyDto {
  id: string;
  code: string;
  name: string;
  symbol: string;
  numericCode: string | null;
  decimalPlaces: number;
  region: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Returned by GET /admin/currencies only — the plain list/detail
 * reads (GET /public/currencies, /admin/currencies/:id) return
 * CurrencyDto without these computed fields. */
export interface AdminCurrencyDto extends CurrencyDto {
  isDefault: boolean;
  isFallback: boolean;
  providerAvailable: boolean;
}

export interface CreateCurrencyPayload {
  code: string;
  name: string;
  symbol: string;
  numericCode?: string;
  decimalPlaces?: number;
  region?: string;
  isActive?: boolean;
}

export interface UpdateCurrencyPayload {
  name?: string;
  symbol?: string;
  numericCode?: string;
  decimalPlaces?: number;
  region?: string;
  isActive?: boolean;
}

export interface CurrencySettingsDto {
  id: string;
  defaultCurrencyId: string;
  defaultCurrency: CurrencyDto;
  fallbackCurrencyId: string;
  fallbackCurrency: CurrencyDto;
  autoDetectEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCurrencySettingsPayload {
  defaultCurrencyId?: string;
  fallbackCurrencyId?: string;
  autoDetectEnabled?: boolean;
}

export interface CurrencyCountryMappingDto {
  id: string;
  countryCode: string;
  countryName: string;
  currencyId: string;
  currency: CurrencyDto;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCountryMappingPayload {
  countryCode: string;
  countryName: string;
  currencyId: string;
}

export interface UpdateCountryMappingPayload {
  countryName?: string;
  currencyId?: string;
}

export interface SetPlanPricePayload {
  currencyId: string;
  amount?: number;
  useExchangeRate?: boolean;
  providerPlanId?: string | null;
  syncToProvider?: boolean;
}

export type CurrencyResolutionSource =
  'EXPLICIT' | 'USER_PREFERENCE' | 'IP_DETECTED' | 'FALLBACK';

/** GET /public/currencies/detect — never persists anything; a
 * separate explicit action (PATCH /users/me/currency-preference)
 * is what saves a user's choice (see Sprint 16 §6/§7). */
export interface DetectedCurrencyDto {
  currency: CurrencyDto;
  source: CurrencyResolutionSource;
  detectedCountry: string | null;
}
