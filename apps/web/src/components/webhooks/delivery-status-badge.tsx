'use client';

import type { WebhookDeliveryStatus } from '@linkiq/types';
import { Badge } from '@linkiq/ui';

const VARIANT_BY_STATUS: Record<
  WebhookDeliveryStatus,
  'secondary' | 'success' | 'warning' | 'destructive'
> = {
  PENDING: 'secondary',
  PROCESSING: 'secondary',
  DELIVERED: 'success',
  FAILED: 'warning',
  EXHAUSTED: 'destructive',
};

const LABEL_BY_STATUS: Record<WebhookDeliveryStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  EXHAUSTED: 'Exhausted',
};

export function DeliveryStatusBadge({
  status,
}: {
  status: WebhookDeliveryStatus;
}) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>
  );
}
