import type { PlanLimitKey } from '@linkiq/types';

export const FEATURE_LABELS: Record<PlanLimitKey, string> = {
  MAX_LINKS: 'Links',
  MAX_QR_CODES: 'QR codes',
  MAX_CAMPAIGNS: 'Campaigns',
  MAX_CUSTOM_DOMAINS: 'Custom domains',
  MAX_TEAM_MEMBERS: 'Team members',
  MONTHLY_CLICKS: 'Monthly clicks',
  ANALYTICS_RETENTION_DAYS: 'Analytics retention (days)',
};

/** The subset shown as progress bars in the Usage section — matches
 * BillingUsageService.getUsage()'s metered keys (ANALYTICS_RETENTION_DAYS
 * is a retention window, not something a workspace "uses up"). */
export const USAGE_BAR_KEYS: PlanLimitKey[] = [
  'MAX_LINKS',
  'MAX_QR_CODES',
  'MAX_CAMPAIGNS',
  'MAX_CUSTOM_DOMAINS',
  'MAX_TEAM_MEMBERS',
  'MONTHLY_CLICKS',
];
