'use client';

import type { DomainStatus } from '@linkiq/types';
import { Badge } from '@linkiq/ui';

const VARIANT_BY_STATUS: Record<
  DomainStatus,
  'success' | 'secondary' | 'outline' | 'warning' | 'destructive'
> = {
  PENDING: 'outline',
  VERIFYING: 'warning',
  VERIFIED: 'secondary',
  ACTIVE: 'success',
  FAILED: 'destructive',
  DISABLED: 'outline',
};

const LABEL_BY_STATUS: Record<DomainStatus, string> = {
  PENDING: 'Pending',
  VERIFYING: 'Verifying',
  VERIFIED: 'Verified',
  ACTIVE: 'Active',
  FAILED: 'Verification failed',
  DISABLED: 'Disabled',
};

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>
  );
}
