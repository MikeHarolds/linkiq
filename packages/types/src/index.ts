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
  | 'ANALYTICS_RETENTION_DAYS';

export type SubscriptionStatus =
  'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

export interface PlanLimitDto {
  key: PlanLimitKey;
  /** null = unlimited. */
  value: number | null;
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
}

export interface InvoiceDto {
  id: string;
  workspaceId: string;
  subscriptionId: string | null;
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
