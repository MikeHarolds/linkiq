/**
 * Formatting helpers shared across the LinkIQ apps.
 */

/** Format a number using locale-aware thousands separators. */
export function formatNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Format a compact number, e.g. 1200 -> "1.2K". */
export function formatCompactNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Format a Date (or ISO string) as an absolute, human-readable date. */
export function formatDate(
  value: Date | string,
  locale = 'en-US',
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  },
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** Format a Date (or ISO string) as a relative time, e.g. "3 hours ago". */
export function formatRelativeTime(
  value: Date | string,
  locale = 'en-US',
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);

  const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const [unit, secondsInUnit] of divisions) {
    if (Math.abs(diffSeconds) >= secondsInUnit || unit === 'second') {
      return rtf.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }

  return rtf.format(diffSeconds, 'second');
}
