export type AnalyticsRange =
  'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';

export interface ResolvedRange {
  from: Date;
  to: Date;
}

/**
 * Returns the difference (in minutes) between UTC and `timeZone` at the
 * instant `date` — positive when the zone is ahead of UTC. Handles DST
 * correctly because it asks the actual IANA tzdata (via Intl) what wall-
 * clock time `date` corresponds to in that zone, rather than assuming a
 * fixed offset.
 */
function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return Math.round((asIfUtc - date.getTime()) / 60_000);
}

/**
 * The UTC instant corresponding to midnight, on the calendar day `instant`
 * falls on when viewed in `timeZone`. This is the building block every
 * named range (today/yesterday/7d/...) is computed from — get this right
 * and every range is automatically correct across DST transitions too.
 */
export function startOfDayInTimezone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const naiveMidnightUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    0,
    0,
    0,
  );
  const offsetMinutes = getTimezoneOffsetMinutes(
    new Date(naiveMidnightUtc),
    timeZone,
  );
  return new Date(naiveMidnightUtc - offsetMinutes * 60_000);
}

/**
 * Resolves a named or custom range into concrete UTC instants, anchored
 * to "now" as observed in `timeZone`. `to` is always exclusive-end (the
 * start of the day AFTER the range's last day), so range queries can use
 * a simple `occurredAt >= from AND occurredAt < to` without off-by-one
 * boundary bugs.
 */
export function resolveDateRange(
  range: AnalyticsRange,
  timeZone: string,
  customFrom?: string,
  customTo?: string,
): ResolvedRange {
  const now = new Date();
  const todayStart = startOfDayInTimezone(now, timeZone);
  const dayMs = 24 * 60 * 60 * 1000;

  switch (range) {
    case 'today':
      return { from: todayStart, to: new Date(todayStart.getTime() + dayMs) };
    case 'yesterday':
      return {
        from: new Date(todayStart.getTime() - dayMs),
        to: todayStart,
      };
    case '7d':
      return {
        from: new Date(todayStart.getTime() - 7 * dayMs),
        to: new Date(todayStart.getTime() + dayMs),
      };
    case '30d':
      return {
        from: new Date(todayStart.getTime() - 30 * dayMs),
        to: new Date(todayStart.getTime() + dayMs),
      };
    case '90d':
      return {
        from: new Date(todayStart.getTime() - 90 * dayMs),
        to: new Date(todayStart.getTime() + dayMs),
      };
    case 'custom': {
      if (!customFrom || !customTo) {
        throw new Error(
          'customFrom and customTo are required when range=custom',
        );
      }
      const from = new Date(customFrom);
      const to = new Date(customTo);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new Error('customFrom/customTo must be valid ISO timestamps');
      }
      if (from.getTime() >= to.getTime()) {
        throw new Error('customFrom must be before customTo');
      }
      return { from, to };
    }
  }
}
