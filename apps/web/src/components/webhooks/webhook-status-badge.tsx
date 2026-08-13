'use client';

import type { WebhookEndpointStatus } from '@linkiq/types';
import { Badge } from '@linkiq/ui';

const VARIANT_BY_STATUS: Record<
  WebhookEndpointStatus,
  'success' | 'warning' | 'destructive'
> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  DISABLED: 'destructive',
};

const LABEL_BY_STATUS: Record<WebhookEndpointStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  DISABLED: 'Disabled',
};

export function WebhookStatusBadge({
  status,
}: {
  status: WebhookEndpointStatus;
}) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>
  );
}
