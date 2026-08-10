'use client';

import type { CampaignStatus } from '@linkiq/types';
import { Badge } from '@linkiq/ui';

const VARIANT_BY_STATUS: Record<
  CampaignStatus,
  'success' | 'secondary' | 'outline' | 'warning'
> = {
  DRAFT: 'outline',
  ACTIVE: 'success',
  PAUSED: 'secondary',
  COMPLETED: 'warning',
  ARCHIVED: 'outline',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status]}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}
