import type { ApiKeyPermission } from '@linkiq/types';

export const PERMISSION_LABELS: Record<ApiKeyPermission, string> = {
  LINKS_READ: 'Read links',
  LINKS_WRITE: 'Create & manage links',
  CAMPAIGNS_READ: 'Read campaigns',
  CAMPAIGNS_WRITE: 'Create & manage campaigns',
  QRCODES_READ: 'Read QR codes',
  QRCODES_WRITE: 'Create & manage QR codes',
  ANALYTICS_READ: 'Read analytics',
  DOMAINS_READ: 'Read custom domains',
  DOMAINS_WRITE: 'Create & manage custom domains',
  WORKSPACE_READ: 'Read workspace info',
};

/** Grouped for the create-key dialog's checkbox list — presented by
 * resource rather than as one flat alphabetical list. */
export const PERMISSION_GROUPS: {
  label: string;
  permissions: ApiKeyPermission[];
}[] = [
  { label: 'Links', permissions: ['LINKS_READ', 'LINKS_WRITE'] },
  { label: 'Campaigns', permissions: ['CAMPAIGNS_READ', 'CAMPAIGNS_WRITE'] },
  { label: 'QR codes', permissions: ['QRCODES_READ', 'QRCODES_WRITE'] },
  { label: 'Custom domains', permissions: ['DOMAINS_READ', 'DOMAINS_WRITE'] },
  { label: 'Analytics', permissions: ['ANALYTICS_READ'] },
  { label: 'Workspace', permissions: ['WORKSPACE_READ'] },
];
