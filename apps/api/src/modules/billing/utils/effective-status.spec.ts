import { SubscriptionStatus } from '@prisma/client';

import { getEffectiveStatus, isEffectivelyOnPlan } from './effective-status';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const PAST = new Date('2026-06-01T00:00:00.000Z');
const FUTURE = new Date('2026-07-01T00:00:00.000Z');

describe('getEffectiveStatus', () => {
  it('returns ACTIVE unchanged when nothing is pending', () => {
    expect(
      getEffectiveStatus(
        { status: SubscriptionStatus.ACTIVE, trialEnd: null, cancelAt: null },
        NOW,
      ),
    ).toBe(SubscriptionStatus.ACTIVE);
  });

  it('derives EXPIRED for a TRIALING subscription whose trialEnd has passed', () => {
    expect(
      getEffectiveStatus(
        { status: SubscriptionStatus.TRIALING, trialEnd: PAST, cancelAt: null },
        NOW,
      ),
    ).toBe(SubscriptionStatus.EXPIRED);
  });

  it('keeps TRIALING when trialEnd is still in the future', () => {
    expect(
      getEffectiveStatus(
        {
          status: SubscriptionStatus.TRIALING,
          trialEnd: FUTURE,
          cancelAt: null,
        },
        NOW,
      ),
    ).toBe(SubscriptionStatus.TRIALING);
  });

  it('derives CANCELED once cancelAt has passed, even if status is still ACTIVE', () => {
    expect(
      getEffectiveStatus(
        { status: SubscriptionStatus.ACTIVE, trialEnd: null, cancelAt: PAST },
        NOW,
      ),
    ).toBe(SubscriptionStatus.CANCELED);
  });

  it('keeps ACTIVE when cancelAt is scheduled but not yet reached (access continues)', () => {
    expect(
      getEffectiveStatus(
        { status: SubscriptionStatus.ACTIVE, trialEnd: null, cancelAt: FUTURE },
        NOW,
      ),
    ).toBe(SubscriptionStatus.ACTIVE);
  });

  it('treats cancelAt exactly at "now" as reached (inclusive boundary)', () => {
    expect(
      getEffectiveStatus(
        { status: SubscriptionStatus.ACTIVE, trialEnd: null, cancelAt: NOW },
        NOW,
      ),
    ).toBe(SubscriptionStatus.CANCELED);
  });

  it('passes through PAST_DUE and PAUSED unchanged', () => {
    expect(
      getEffectiveStatus(
        { status: SubscriptionStatus.PAST_DUE, trialEnd: null, cancelAt: null },
        NOW,
      ),
    ).toBe(SubscriptionStatus.PAST_DUE);
    expect(
      getEffectiveStatus(
        { status: SubscriptionStatus.PAUSED, trialEnd: null, cancelAt: null },
        NOW,
      ),
    ).toBe(SubscriptionStatus.PAUSED);
  });

  it('keeps PAST_DUE unchanged when pastDueSince is null (no grace period tracked)', () => {
    expect(
      getEffectiveStatus(
        {
          status: SubscriptionStatus.PAST_DUE,
          trialEnd: null,
          cancelAt: null,
          pastDueSince: null,
        },
        NOW,
      ),
    ).toBe(SubscriptionStatus.PAST_DUE);
  });

  it('keeps PAST_DUE while still within the grace period', () => {
    const pastDueSince = new Date('2026-06-10T12:00:00.000Z'); // 5 days before NOW
    expect(
      getEffectiveStatus(
        {
          status: SubscriptionStatus.PAST_DUE,
          trialEnd: null,
          cancelAt: null,
          pastDueSince,
        },
        NOW,
        7,
      ),
    ).toBe(SubscriptionStatus.PAST_DUE);
  });

  it('derives EXPIRED once PAST_DUE has exceeded the grace period', () => {
    const pastDueSince = new Date('2026-06-01T12:00:00.000Z'); // 14 days before NOW
    expect(
      getEffectiveStatus(
        {
          status: SubscriptionStatus.PAST_DUE,
          trialEnd: null,
          cancelAt: null,
          pastDueSince,
        },
        NOW,
        7,
      ),
    ).toBe(SubscriptionStatus.EXPIRED);
  });

  it('respects a custom grace period length', () => {
    const pastDueSince = new Date('2026-06-10T12:00:00.000Z'); // 5 days before NOW
    expect(
      getEffectiveStatus(
        {
          status: SubscriptionStatus.PAST_DUE,
          trialEnd: null,
          cancelAt: null,
          pastDueSince,
        },
        NOW,
        3, // shorter than the default — should already be expired
      ),
    ).toBe(SubscriptionStatus.EXPIRED);
  });

  it('lets an explicit cancelAt take priority over an expired PAST_DUE grace period', () => {
    const pastDueSince = new Date('2026-06-01T12:00:00.000Z'); // well past the grace period
    expect(
      getEffectiveStatus(
        {
          status: SubscriptionStatus.PAST_DUE,
          trialEnd: null,
          cancelAt: PAST,
          pastDueSince,
        },
        NOW,
        7,
      ),
    ).toBe(SubscriptionStatus.CANCELED);
  });

  it('falls back to the default grace period (7 days) when none is passed', () => {
    const justOverSevenDaysAgo = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1,
    );
    expect(
      getEffectiveStatus(
        {
          status: SubscriptionStatus.PAST_DUE,
          trialEnd: null,
          cancelAt: null,
          pastDueSince: justOverSevenDaysAgo,
        },
        NOW,
      ),
    ).toBe(SubscriptionStatus.EXPIRED);
  });
});

describe('isEffectivelyOnPlan', () => {
  it.each([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
  ])('returns true for %s', (status) => {
    expect(isEffectivelyOnPlan(status)).toBe(true);
  });

  it.each([
    SubscriptionStatus.PAUSED,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.EXPIRED,
  ])('returns false for %s', (status) => {
    expect(isEffectivelyOnPlan(status)).toBe(false);
  });
});
