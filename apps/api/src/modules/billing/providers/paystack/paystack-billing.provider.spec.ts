import { BadRequestException } from '@nestjs/common';

import type { PaystackApiClient } from './paystack-api.client';
import { PaystackApiException } from './paystack-api.exception';
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
    // Sprint 18B §17 — createCheckoutSession no longer reads
    // providerPlanId/PlanPrice at all: the caller (SubscriptionsService)
    // always supplies the exact amount/currency to charge (straight
    // from the originating Invoice), and this method sends exactly
    // that to Paystack — never a `plan` code, which would let Paystack
    // silently substitute its own stored price instead.

    it('initializes a transaction for exactly the caller-supplied amount/currency, never a plan code', async () => {
      plans.getBySlug.mockResolvedValue({
        slug: 'starter',
        currency: 'NGN',
        providerPlanId: null,
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
        amountMinorUnits: 2_900_000,
      });

      // The returned reference is the one PaystackBillingProvider itself
      // generated and sent to initializeTransaction (see
      // generatePaystackReference) — not api.initializeTransaction's own
      // mocked response, which is only used for authorizationUrl here.
      expect(result).toEqual({
        devFlow: false,
        checkoutUrl: 'https://checkout.paystack.com/xyz',
        reference: expect.any(String),
      });
      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          amountKobo: 2_900_000,
          currency: 'NGN',
          metadata: { workspaceId: 'ws-1', planSlug: 'starter', currency: 'NGN' },
        }),
      );
      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.not.objectContaining({ planCode: expect.anything() }),
      );
    });

    it('uses successUrl as the callback URL when provided', async () => {
      plans.getBySlug.mockResolvedValue({ slug: 'starter', currency: 'NGN' });
      api.initializeTransaction.mockResolvedValue({
        authorizationUrl: 'https://checkout.paystack.com/xyz',
        accessCode: 'access_xyz',
        reference: 'txn-abc',
      });

      await provider.createCheckoutSession({
        workspaceId: 'ws-1',
        planSlug: 'starter',
        email: 'a@b.com',
        amountMinorUnits: 2_900_000,
        successUrl: 'https://app.linkiq.com/dashboard/billing/callback',
      });

      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: 'https://app.linkiq.com/dashboard/billing/callback',
        }),
      );
    });

    it('sends the caller-supplied currencyCode, overriding the plan base currency', async () => {
      plans.getBySlug.mockResolvedValue({
        slug: 'professional',
        currency: 'NGN',
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
        currencyCode: 'USD',
        amountMinorUnits: 4900,
      });

      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ amountKobo: 4900, currency: 'USD' }),
      );
    });

    it('embeds invoiceId in metadata when supplied', async () => {
      plans.getBySlug.mockResolvedValue({ slug: 'starter', currency: 'NGN' });
      api.initializeTransaction.mockResolvedValue({
        authorizationUrl: 'https://checkout.paystack.com/xyz',
        accessCode: 'access_xyz',
        reference: 'txn-abc',
      });

      await provider.createCheckoutSession({
        workspaceId: 'ws-1',
        planSlug: 'starter',
        email: 'a@b.com',
        amountMinorUnits: 2_900_000,
        invoiceId: 'inv-1',
      });

      expect(api.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ invoiceId: 'inv-1' }),
        }),
      );
    });

    // Sprint 18B §16 — discovered via a live TEST-mode Paystack call:
    // getSupportedCurrencies()'s static allowlist can say a currency is
    // fine while the LIVE merchant account still rejects it (real
    // Paystack response: HTTP 403 "Currency not supported by merchant").
    // Without translation this propagated as an unhandled 500.
    it('translates a Paystack 403 (currency not enabled on the merchant account) into a friendly BadRequestException', async () => {
      plans.getBySlug.mockResolvedValue({ slug: 'starter', currency: 'USD' });
      api.initializeTransaction.mockRejectedValue(
        new PaystackApiException('Currency not supported by merchant', 403),
      );

      await expect(
        provider.createCheckoutSession({
          workspaceId: 'ws-1',
          planSlug: 'starter',
          email: 'a@b.com',
          currencyCode: 'USD',
          amountMinorUnits: 1900,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        provider.createCheckoutSession({
          workspaceId: 'ws-1',
          planSlug: 'starter',
          email: 'a@b.com',
          currencyCode: 'USD',
          amountMinorUnits: 1900,
        }),
      ).rejects.toThrow(
        'Payment in USD is not currently available. Please select another currency.',
      );
    });

    it('re-throws a non-403 PaystackApiException unchanged (not misrepresented as a currency problem)', async () => {
      plans.getBySlug.mockResolvedValue({ slug: 'starter', currency: 'NGN' });
      api.initializeTransaction.mockRejectedValue(
        new PaystackApiException('Paystack request failed with HTTP 500', 500),
      );

      await expect(
        provider.createCheckoutSession({
          workspaceId: 'ws-1',
          planSlug: 'starter',
          email: 'a@b.com',
          amountMinorUnits: 2_900_000,
        }),
      ).rejects.toThrow(PaystackApiException);
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
        currency: 'USD',
        customerCode: 'CUS_abc',
        authorizationCode: 'AUTH_abc',
        planCode: 'PLN_starter',
        paidAt: new Date(),
        metadata: null,
      });

      const result = await provider.verifyTransaction('txn-abc');

      expect(result).toEqual({
        success: true,
        reference: 'txn-abc',
        amountKobo: 190000,
        currency: 'USD',
        customerCode: 'CUS_abc',
        metadata: null,
      });
    });

    it('reports failure for a non-success transaction status', async () => {
      api.verifyTransaction.mockResolvedValue({
        status: 'abandoned',
        reference: 'txn-abc',
        amountKobo: 190000,
        currency: 'USD',
        customerCode: null,
        authorizationCode: null,
        planCode: null,
        paidAt: null,
        metadata: null,
      });

      const result = await provider.verifyTransaction('txn-abc');

      expect(result).toEqual({
        success: false,
        reference: 'txn-abc',
        amountKobo: 190000,
        currency: 'USD',
        customerCode: null,
        metadata: null,
      });
    });
  });
});
