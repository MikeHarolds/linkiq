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
        { status: SubscriptionStatus.TRIALING, trialEnd: FUTURE, cancelAt: null },
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
