import { startOfDayInTimezone } from '../../analytics/utils/date-range';

export interface ReportPeriod {
  periodStart: Date;
  periodEnd: Date;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Yesterday, UTC midnight to UTC midnight. */
export function computeDailyPeriod(now: Date = new Date()): ReportPeriod {
  const todayStart = startOfDayInTimezone(now, 'UTC');
  const periodStart = new Date(todayStart.getTime() - DAY_MS);
  const periodEnd = todayStart;
  return { periodStart, periodEnd, label: isoDate(periodStart) };
}

/**
 * The prior COMPLETE Monday-Sunday UTC week — deliberately NOT
 * AnalyticsQueryDto's `range: '7d'` (that includes today, a partial
 * day; see analytics.service.ts's own note on this). Computed once here
 * so ReportDispatchService (idempotency key) and ReportGenerationService
 * (analytics query bounds) always agree on the exact same boundaries.
 */
export function computeWeeklyPeriod(now: Date = new Date()): ReportPeriod {
  const todayStart = startOfDayInTimezone(now, 'UTC');
  const dayOfWeek = todayStart.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0..Sun=6
  const thisMonday = new Date(todayStart.getTime() - daysSinceMonday * DAY_MS);
  const periodStart = new Date(thisMonday.getTime() - 7 * DAY_MS);
  const periodEnd = thisMonday;
  const periodEndInclusive = new Date(periodEnd.getTime() - DAY_MS);
  return {
    periodStart,
    periodEnd,
    label: `${isoDate(periodStart)} – ${isoDate(periodEndInclusive)}`,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
