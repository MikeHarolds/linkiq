'use client';

import type { UsageSnapshotDto } from '@linkiq/types';

import { FEATURE_LABELS } from './feature-labels';

/** `usageKey` rather than `key` — `UsageSnapshotDto.key` collides with
 * JSX's reserved `key` prop when a caller spreads the DTO onto this
 * component, so the DTO is destructured explicitly instead. */
type UsageRowProps = Omit<UsageSnapshotDto, 'key'> & {
  usageKey: UsageSnapshotDto['key'];
};

export function UsageRow({
  usageKey,
  usage,
  limit,
  remaining,
  unlimited,
}: UsageRowProps) {
  const percent =
    unlimited || limit === null || limit === 0
      ? 0
      : Math.min(100, Math.round((usage / limit) * 100));
  const exhausted = !unlimited && remaining === 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{FEATURE_LABELS[usageKey] ?? usageKey}</span>
        <span className="text-muted-foreground">
          {unlimited
            ? `${usage.toLocaleString()} · Unlimited`
            : `${usage.toLocaleString()} / ${limit!.toLocaleString()}`}
        </span>
      </div>
      {!unlimited && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-[width] ${
              exhausted ? 'bg-destructive' : 'bg-primary'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {exhausted && (
        <p className="text-xs text-destructive">
          Limit reached — upgrade your plan to add more.
        </p>
      )}
    </div>
  );
}
