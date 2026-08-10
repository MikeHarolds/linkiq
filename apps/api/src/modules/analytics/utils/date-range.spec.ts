import { resolveDateRange, startOfDayInTimezone } from './date-range';

describe('startOfDayInTimezone', () => {
  // 2026-01-15T03:00:00Z: already Jan 15 in UTC and Tokyo, still Jan 14
  // evening in Los Angeles (UTC-8, no DST in January).
  const instant = new Date('2026-01-15T03:00:00.000Z');

  it('resolves UTC correctly', () => {
    expect(startOfDayInTimezone(instant, 'UTC').toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  it('resolves a UTC-negative zone correctly (still the previous day)', () => {
    expect(
      startOfDayInTimezone(instant, 'America/Los_Angeles').toISOString(),
    ).toBe('2026-01-14T08:00:00.000Z');
  });

  it('resolves a UTC-positive zone correctly (already the next day)', () => {
    expect(startOfDayInTimezone(instant, 'Asia/Tokyo').toISOString()).toBe(
      '2026-01-14T15:00:00.000Z',
    );
  });

  it('handles a DST transition correctly (US spring-forward, March 2026)', () => {
    // 2026-03-08 is the second Sunday of March — US DST begins that day.
    // An instant just after US DST starts should resolve to a midnight
    // that's still offset by the OLD (winter) UTC-8 offset, since the
    // calendar day in LA hasn't crossed the transition yet at this instant.
    const beforeSpringForward = new Date('2026-03-08T09:00:00.000Z'); // 01:00 PST
    const start = startOfDayInTimezone(
      beforeSpringForward,
      'America/Los_Angeles',
    );
    expect(start.toISOString()).toBe('2026-03-08T08:00:00.000Z'); // midnight PST = 08:00 UTC
  });
});

describe('resolveDateRange', () => {
  it('"today" returns a 24-hour window', () => {
    const { from, to } = resolveDateRange('today', 'UTC');
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('"yesterday" ends exactly where "today" begins', () => {
    const today = resolveDateRange('today', 'UTC');
    const yesterday = resolveDateRange('yesterday', 'UTC');
    expect(yesterday.to.getTime()).toBe(today.from.getTime());
  });

  it('"7d" spans 8 days (7 full days back through today, inclusive)', () => {
    const { from, to } = resolveDateRange('7d', 'UTC');
    expect((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)).toBe(8);
  });

  it('"30d" and "90d" scale accordingly', () => {
    const d30 = resolveDateRange('30d', 'UTC');
    const d90 = resolveDateRange('90d', 'UTC');
    expect(
      (d30.to.getTime() - d30.from.getTime()) / (24 * 60 * 60 * 1000),
    ).toBe(31);
    expect(
      (d90.to.getTime() - d90.from.getTime()) / (24 * 60 * 60 * 1000),
    ).toBe(91);
  });

  it('produces different boundaries for the same range in different timezones', () => {
    const utc = resolveDateRange('today', 'UTC');
    const tokyo = resolveDateRange('today', 'Asia/Tokyo');
    // Tokyo is UTC+9, so the two "today" boundaries must differ by 9
    // hours in one direction — equivalently 15 hours (24-9) in the
    // other, depending on which side of local midnight "now" falls on.
    const diffHours =
      Math.abs(utc.from.getTime() - tokyo.from.getTime()) / (60 * 60 * 1000);
    expect(Math.min(diffHours, 24 - diffHours)).toBeCloseTo(9, 5);
  });

  it('parses a valid custom range', () => {
    const { from, to } = resolveDateRange(
      'custom',
      'UTC',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T00:00:00.000Z',
    );
    expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('throws when custom range is missing from/to', () => {
    expect(() => resolveDateRange('custom', 'UTC')).toThrow(/required/);
  });

  it('throws when custom from is after custom to', () => {
    expect(() =>
      resolveDateRange(
        'custom',
        'UTC',
        '2026-02-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ),
    ).toThrow(/before/);
  });

  it('throws on an unparseable custom date', () => {
    expect(() =>
      resolveDateRange(
        'custom',
        'UTC',
        'not-a-date',
        '2026-01-01T00:00:00.000Z',
      ),
    ).toThrow();
  });
});
