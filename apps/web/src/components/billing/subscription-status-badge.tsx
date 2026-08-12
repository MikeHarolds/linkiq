'use client';

import type { SubscriptionStatus } from '@linkiq/types';
import { Badge } from '@linkiq/ui';

const VARIANT_BY_STATUS: Record<
  SubscriptionStatus,
  'success' | 'secondary' | 'outline' | 'warning' | 'destructive'
> = {
  TRIALING: 'secondary',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  PAUSED: 'outline',
  CANCELED: 'destructive',
  EXPIRED: 'destructive',
};

const LABEL_BY_STATUS: Record<SubscriptionStatus, string> = {
  TRIALING: 'Trialing',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  PAUSED: 'Paused',
  CANCELED: 'Canceled',
  EXPIRED: 'Expired',
};

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  return <Badge variant={VARIANT_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>;
}
