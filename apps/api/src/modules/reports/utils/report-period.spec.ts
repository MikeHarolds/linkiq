import { computeDailyPeriod, computeWeeklyPeriod } from './report-period';

describe('computeDailyPeriod', () => {
  it('returns exactly yesterday, UTC midnight to UTC midnight', () => {
    const period = computeDailyPeriod(new Date('2026-08-21T15:30:00.000Z'));
    expect(period.periodStart.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });
});

describe('computeWeeklyPeriod', () => {
  it('excludes the current (partial) week — resolves to the prior complete Monday-Sunday', () => {
    // 2026-08-21 is a Friday.
    const period = computeWeeklyPeriod(new Date('2026-08-21T15:30:00.000Z'));
    expect(period.periodStart.toISOString()).toBe('2026-08-10T00:00:00.000Z'); // prior Monday
    expect(period.periodEnd.toISOString()).toBe('2026-08-17T00:00:00.000Z'); // this Monday (exclusive)
  });

  it('produces the same prior week whether "now" is Monday or Sunday of the current week', () => {
    const onMonday = computeWeeklyPeriod(new Date('2026-08-17T00:00:00.000Z'));
    const onSunday = computeWeeklyPeriod(new Date('2026-08-23T23:59:59.000Z'));
    expect(onMonday.periodStart.toISOString()).toBe(onSunday.periodStart.toISOString());
    expect(onMonday.periodEnd.toISOString()).toBe(onSunday.periodEnd.toISOString());
  });

  it('spans exactly 7 days', () => {
    const period = computeWeeklyPeriod(new Date('2026-08-21T00:00:00.000Z'));
    const spanMs = period.periodEnd.getTime() - period.periodStart.getTime();
    expect(spanMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
