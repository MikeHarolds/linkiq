import type { ApiKeyPermission } from '@linkiq/types';

export const PERMISSION_LABELS: Record<ApiKeyPermission, string> = {
  LINKS_READ: 'Read links',
  LINKS_WRITE: 'Create & manage links',
  CAMPAIGNS_READ: 'Read campaigns',
  CAMPAIGNS_WRITE: 'Create & manage campaigns',
  QRCODES_READ: 'Read QR codes',
  QRCODES_WRITE: 'Create & manage QR codes',
  LINK_SOURCES_READ: 'Read tracking sources',
  LINK_SOURCES_WRITE: 'Create & manage tracking sources',
  ANALYTICS_READ: 'Read analytics',
  DOMAINS_READ: 'Read custom domains',
  DOMAINS_WRITE: 'Create & manage custom domains',
  WORKSPACE_READ: 'Read workspace info',
  WEBHOOKS_READ: 'Read webhook endpoints',
  WEBHOOKS_WRITE: 'Create & manage webhook endpoints',
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
  {
    label: 'Tracking sources',
    permissions: ['LINK_SOURCES_READ', 'LINK_SOURCES_WRITE'],
  },
  { label: 'Custom domains', permissions: ['DOMAINS_READ', 'DOMAINS_WRITE'] },
  { label: 'Analytics', permissions: ['ANALYTICS_READ'] },
  { label: 'Webhooks', permissions: ['WEBHOOKS_READ', 'WEBHOOKS_WRITE'] },
  { label: 'Workspace', permissions: ['WORKSPACE_READ'] },
];
