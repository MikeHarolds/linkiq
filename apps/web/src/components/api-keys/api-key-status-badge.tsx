'use client';

import type { ApiKeyStatus } from '@linkiq/types';
import { Badge } from '@linkiq/ui';

const VARIANT_BY_STATUS: Record<
  ApiKeyStatus,
  'success' | 'outline' | 'destructive'
> = {
  ACTIVE: 'success',
  EXPIRED: 'outline',
  REVOKED: 'destructive',
};

const LABEL_BY_STATUS: Record<ApiKeyStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

export function ApiKeyStatusBadge({ status }: { status: ApiKeyStatus }) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>
  );
}
