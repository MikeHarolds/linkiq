import type { ConfigService } from '@nestjs/config';

import type { PaystackApiClient } from '../../billing/providers/paystack/paystack-api.client';
import { PaystackApiException } from '../../billing/providers/paystack/paystack-api.exception';

import { AdminSettingsService } from './admin-settings.service';

describe('AdminSettingsService', () => {
  let config: { get: jest.Mock };
  let paystackApi: { getSubscription: jest.Mock };
  let service: AdminSettingsService;
  const originalEnv = process.env.BILLING_PROVIDER;

  beforeEach(() => {
    config = { get: jest.fn() };
    paystackApi = { getSubscription: jest.fn() };
    service = new AdminSettingsService(
      config as unknown as ConfigService,
      paystackApi as unknown as PaystackApiClient,
    );
  });

  afterEach(() => {
    process.env.BILLING_PROVIDER = originalEnv;
  });

  describe('getPaymentsSettings', () => {
    it('never returns the secret key itself — only a configured boolean and derived mode', () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'paystack.secretKey')
          return 'sk_test_supersecretvalue12345';
        if (key === 'paystack.publicKey') return 'pk_test_public';
        return undefined;
      });

      const result = service.getPaymentsSettings();

      expect(result.secretKeyConfigured).toBe(true);
      expect(result.mode).toBe('test');
      expect(JSON.stringify(result)).not.toContain('supersecretvalue');
      expect(JSON.stringify(result)).not.toContain('sk_test_');
    });

    it('classifies a live-mode key correctly', () => {
      config.get.mockImplementation((key: string) =>
        key === 'paystack.secretKey' ? 'sk_live_abcdef' : undefined,
      );
      expect(service.getPaymentsSettings().mode).toBe('live');
    });

    it('reports not-configured when no secret key is set', () => {
      config.get.mockReturnValue(undefined);
      const result = service.getPaymentsSettings();
      expect(result.secretKeyConfigured).toBe(false);
      expect(result.publicKeyConfigured).toBe(false);
      expect(result.mode).toBe('unknown');
    });
  });

  describe('testPaystackConnection', () => {
    it('reports not-connected when the billing provider is not paystack', async () => {
      process.env.BILLING_PROVIDER = 'development';
      const result = await service.testPaystackConnection();
      expect(result.connected).toBe(false);
      expect(paystackApi.getSubscription).not.toHaveBeenCalled();
    });

    it('reports not-connected when no secret key is configured', async () => {
      process.env.BILLING_PROVIDER = 'paystack';
      config.get.mockReturnValue(undefined);
      const result = await service.testPaystackConnection();
      expect(result.connected).toBe(false);
      expect(result.message).toMatch(/not configured/i);
    });

    it('treats a 401 from Paystack as an invalid key', async () => {
      process.env.BILLING_PROVIDER = 'paystack';
      config.get.mockImplementation((key: string) =>
        key === 'paystack.secretKey' ? 'sk_test_x' : undefined,
      );
      paystackApi.getSubscription.mockRejectedValue(
        new PaystackApiException('Unauthorized', 401),
      );

      const result = await service.testPaystackConnection();
      expect(result.connected).toBe(false);
      expect(result.message).toMatch(/rejected/i);
    });

    it('treats a 404 (or any non-401) as a successfully authenticated key', async () => {
      process.env.BILLING_PROVIDER = 'paystack';
      config.get.mockImplementation((key: string) =>
        key === 'paystack.secretKey' ? 'sk_test_x' : undefined,
      );
      paystackApi.getSubscription.mockRejectedValue(
        new PaystackApiException('Not found', 404),
      );

      const result = await service.testPaystackConnection();
      expect(result.connected).toBe(true);
    });

    it('treats a genuine successful call as connected', async () => {
      process.env.BILLING_PROVIDER = 'paystack';
      config.get.mockImplementation((key: string) =>
        key === 'paystack.secretKey' ? 'sk_test_x' : undefined,
      );
      paystackApi.getSubscription.mockResolvedValue({});

      const result = await service.testPaystackConnection();
      expect(result.connected).toBe(true);
    });
  });
});
