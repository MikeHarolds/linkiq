import { Badge } from '@linkiq/ui';

const POSITIVE = new Set([
  'ACTIVE',
  'VERIFIED',
  'DELIVERED',
  'PAID',
  'SUCCEEDED',
  'CONNECTED',
]);
const WARNING = new Set([
  'TRIALING',
  'PAST_DUE',
  'PENDING',
  'VERIFYING',
  'PROCESSING',
  'PAUSED',
]);
const NEGATIVE = new Set([
  'CANCELED',
  'EXPIRED',
  'FAILED',
  'EXHAUSTED',
  'DISABLED',
  'REVOKED',
  'VOID',
  'UNCOLLECTIBLE',
  'SUSPENDED',
]);

/** Generic status → Badge variant mapper shared across every admin list
 * (subscriptions, invoices, domains, webhooks, users). Unrecognized
 * statuses fall back to `outline` rather than guessing. */
export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const variant = POSITIVE.has(normalized)
    ? 'success'
    : WARNING.has(normalized)
      ? 'warning'
      : NEGATIVE.has(normalized)
        ? 'destructive'
        : 'outline';

  return <Badge variant={variant}>{status}</Badge>;
}
