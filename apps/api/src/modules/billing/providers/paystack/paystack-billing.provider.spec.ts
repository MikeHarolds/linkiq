import { BadRequestException } from '@nestjs/common';

import type { PaystackApiClient } from './paystack-api.client';
import {
  PaystackBillingProvider,
  packSubscriptionId,
  unpackSubscriptionId,
} from './paystack-billing.provider';

describe('packSubscriptionId / unpackSubscriptionId', () => {
  it('round-trips a subscription code and email token', () => {
    const packed = packSubscriptionId('SUB_abc', 'tok_xyz');
    expect(unpackSubscriptionId(packed)).toEqual({
      subscriptionCode: 'SUB_abc',
      emailToken: 'tok_xyz',
    });
  });

  it('throws on a malformed id with no separator', () => {
    expect(() => unpackSubscriptionId('not-packed')).toThrow(/Malformed/);
  });
});

describe('PaystackBillingProvider', () => {
  let api: jest.Mocked<
    Pick<
      PaystackApiClient,
      | 'initializeTransaction'
      | 'disableSubscription'
      | 'getSubscription'
      | 'verifyTransaction'
    >
  >;
  let plans: { getBySlug: jest.Mock };
  let config: { get: jest.Mock };
  let provider: PaystackBillingProvider;

  beforeEach(() => {
    api = {
      initializeTransaction: jest.fn(),
      disableSubscription: jest.fn(),
      getSubscription: jest.fn(),
      verifyTransaction: jest.fn(),
    };
    plans = { getBySlug: jest.fn() };
    config = { get: jest.fn().mockReturnValue(undefined) };
    provider = new PaystackBillingProvider(
      api as unknown as PaystackApiClient,
      plans as never,
      config as never,
    );
  });

  describe('createCheckoutSession', () => {
    it('throws BadRequestException when the plan has no providerPlanId', async () => {
      plans.getBySlug.mockResolvedValue({
        slug: 'starter',
        providerPlanId: null,
      });

      await expect(
        provider.createCheckoutSession({
          workspaceId: 'ws-1',
          planSlug: 'starter',
          email: 'a@b.com',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(api.initializeTransaction).not.toHaveBeenCalled();
    });

    it('initializes a transaction and returns the checkout URL', async () => {
      plans.getBySlug.mockResolvedValue({
        slug: 'starter',
        providerPlanId: 'PLN_starter',
        priceAmount: 190000,
      });
      api.initializeTransaction.mockResolvedValue({
        authorizationUrl: 'https://checkout.paystack.com/xyz',
        accessCode: 'access_xyz',
        reference: 'txn-abc',
      });

      const result = await provider.createCheckoutSession({
        workspaceId: 'ws-1',
        planSlug: 'starter',
        email: 'a@b.com',
      });

      expect(result).toEqual({
        devFlow: false,
        checkoutUrl: 'https://checkout.paystack.com/xyz',
      });
      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          amountKobo: 190000,
          planCode: 'PLN_starter',
          metadata: { workspaceId: 'ws-1', planSlug: 'starter' },
        }),
      );
    });

    it('uses successUrl as the callback URL when provided', async () => {
      plans.getBySlug.mockResolvedValue({
        slug: 'starter',
        providerPlanId: 'PLN_starter',
        priceAmount: 190000,
      });
      api.initializeTransaction.mockResolvedValue({
        authorizationUrl: 'https://checkout.paystack.com/xyz',
        accessCode: 'access_xyz',
        reference: 'txn-abc',
      });

      await provider.createCheckoutSession({
        workspaceId: 'ws-1',
        planSlug: 'starter',
        email: 'a@b.com',
        successUrl: 'https://app.linkiq.com/dashboard/billing/callback',
      });

      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: 'https://app.linkiq.com/dashboard/billing/callback',
        }),
      );
    });

    it('resolves a currency-specific PlanPrice and its own providerPlanId when currencyCode differs from the base', async () => {
      plans.getBySlug.mockResolvedValue({
        slug: 'professional',
        currency: 'USD',
        priceAmount: 4900,
        providerPlanId: 'PLN_pro_usd',
        billingInterval: 'MONTHLY',
        prices: [
          {
            currencyId: 'cur-ngn',
            currency: { code: 'NGN' },
            amount: 7_500_000,
            providerPlanId: 'PLN_pro_ngn',
          },
        ],
      });
      api.initializeTransaction.mockResolvedValue({
        authorizationUrl: 'https://checkout.paystack.com/xyz',
        accessCode: 'access_xyz',
        reference: 'txn-abc',
      });

      await provider.createCheckoutSession({
        workspaceId: 'ws-1',
        planSlug: 'professional',
        email: 'a@b.com',
        currencyCode: 'NGN',
      });

      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ amountKobo: 7_500_000, planCode: 'PLN_pro_ngn' }),
      );
    });

    it('throws when no PlanPrice exists for the requested currency', async () => {
      plans.getBySlug.mockResolvedValue({
        slug: 'professional',
        currency: 'USD',
        priceAmount: 4900,
        providerPlanId: 'PLN_pro_usd',
        prices: [],
      });

      await expect(
        provider.createCheckoutSession({
          workspaceId: 'ws-1',
          planSlug: 'professional',
          email: 'a@b.com',
          currencyCode: 'EUR',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(api.initializeTransaction).not.toHaveBeenCalled();
    });
  });

  describe('getSupportedCurrencies', () => {
    it('returns the configured allowlist', () => {
      config.get.mockReturnValue(['NGN', 'USD']);
      expect(provider.getSupportedCurrencies()).toEqual(['NGN', 'USD']);
    });

    it('falls back to NGN/USD when unconfigured', () => {
      config.get.mockReturnValue(undefined);
      expect(provider.getSupportedCurrencies()).toEqual(['NGN', 'USD']);
    });
  });

  describe('cancelSubscription', () => {
    it('unpacks the id and calls disableSubscription with code and token', async () => {
      api.disableSubscription.mockResolvedValue(undefined);

      await provider.cancelSubscription(
        packSubscriptionId('SUB_abc', 'tok_xyz'),
      );

      expect(api.disableSubscription).toHaveBeenCalledWith(
        'SUB_abc',
        'tok_xyz',
      );
    });
  });

  describe('changeSubscription', () => {
    it('always throws — no in-place plan-swap primitive exists', async () => {
      await expect(provider.changeSubscription()).rejects.toThrow(
        /fresh checkout/,
      );
    });
  });

  describe('getSubscription', () => {
    it('returns null when Paystack does not recognize the subscription', async () => {
      api.getSubscription.mockResolvedValue(null);

      const result = await provider.getSubscription(
        packSubscriptionId('SUB_missing', 'tok_xyz'),
      );

      expect(result).toBeNull();
    });

    it('maps a known subscription to a ProviderSubscriptionSnapshot', async () => {
      api.getSubscription.mockResolvedValue({
        subscriptionCode: 'SUB_abc',
        status: 'active',
        nextPaymentDate: new Date('2026-09-13T10:00:00.000Z'),
      });

      const providerSubscriptionId = packSubscriptionId('SUB_abc', 'tok_xyz');
      const result = await provider.getSubscription(providerSubscriptionId);

      expect(result).toEqual({
        providerSubscriptionId,
        status: 'active',
        currentPeriodEnd: new Date('2026-09-13T10:00:00.000Z'),
      });
    });
  });

  describe('handleWebhook', () => {
    it('always throws — inbound webhooks bypass this method', async () => {
      await expect(provider.handleWebhook()).rejects.toThrow(/unused/);
    });
  });

  describe('verifyTransaction', () => {
    it('reports success for a successful transaction', async () => {
      api.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'txn-abc',
        amountKobo: 190000,
        customerCode: 'CUS_abc',
        authorizationCode: 'AUTH_abc',
        planCode: 'PLN_starter',
        paidAt: new Date(),
        metadata: null,
      });

      const result = await provider.verifyTransaction('txn-abc');

      expect(result).toEqual({ success: true, reference: 'txn-abc' });
    });

    it('reports failure for a non-success transaction status', async () => {
      api.verifyTransaction.mockResolvedValue({
        status: 'abandoned',
        reference: 'txn-abc',
        amountKobo: 190000,
        customerCode: null,
        authorizationCode: null,
        planCode: null,
        paidAt: null,
        metadata: null,
      });

      const result = await provider.verifyTransaction('txn-abc');

      expect(result).toEqual({ success: false, reference: 'txn-abc' });
    });
  });
});
