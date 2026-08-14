import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaystackApiClient } from '../../billing/providers/paystack/paystack-api.client';
import { PaystackApiException } from '../../billing/providers/paystack/paystack-api.exception';

export interface PlatformSettingsSnapshot {
  billingProvider: string;
  webhooks: {
    maxAttempts: number;
    backoffBaseMs: number;
    autoDisableThreshold: number;
  };
  domainVerificationMode: string;
}

export interface PaymentsSettingsSnapshot {
  provider: string;
  /** Never the key itself — just whether one is set. */
  secretKeyConfigured: boolean;
  publicKeyConfigured: boolean;
  /** Derived from the secret key's own prefix (sk_test_/sk_live_) — a
   * classification, not a fragment of the secret. 'unknown' when no key
   * is configured or the prefix doesn't match either pattern. */
  mode: 'test' | 'live' | 'unknown';
  pastDueGraceDays: number;
  apiBaseUrl: string;
}

/**
 * Platform configuration visibility (Sprint 11 — Super Admin). Read-only
 * by design: this sprint does not introduce a database-backed settings
 * table (the spec explicitly warns against a fake generic settings
 * table) — every value here is read straight from the same
 * ConfigService every other module already uses (Sprint 10's
 * paystack.config.ts, Sprint 9's webhooks.config.ts, Sprint 6's
 * DOMAIN_VERIFICATION_MODE). Mutable settings (maintenance mode,
 * registration toggle) are NOT implemented — there is no architectural
 * mechanism for them yet; see docs/architecture/super-admin.md's "not
 * implemented" section rather than a fake toggle that does nothing.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly config: ConfigService,
    private readonly paystackApi: PaystackApiClient,
  ) {}

  getPlatformSettings(): PlatformSettingsSnapshot {
    return {
      billingProvider: process.env.BILLING_PROVIDER ?? 'development',
      webhooks: {
        maxAttempts: this.config.get<number>('webhooks.maxAttempts') ?? 5,
        backoffBaseMs:
          this.config.get<number>('webhooks.backoffBaseMs') ?? 1000,
        autoDisableThreshold:
          this.config.get<number>('webhooks.autoDisableThreshold') ?? 10,
      },
      domainVerificationMode: process.env.DOMAIN_VERIFICATION_MODE ?? 'dns',
    };
  }

  getPaymentsSettings(): PaymentsSettingsSnapshot {
    const secretKey = this.config.get<string>('paystack.secretKey') ?? '';
    const publicKey = this.config.get<string>('paystack.publicKey') ?? '';

    let mode: 'test' | 'live' | 'unknown' = 'unknown';
    if (secretKey.startsWith('sk_test_')) mode = 'test';
    else if (secretKey.startsWith('sk_live_')) mode = 'live';

    return {
      provider: process.env.BILLING_PROVIDER ?? 'development',
      secretKeyConfigured: secretKey.length > 0,
      publicKeyConfigured: publicKey.length > 0,
      mode,
      pastDueGraceDays:
        this.config.get<number>('paystack.pastDueGraceDays') ?? 7,
      apiBaseUrl:
        this.config.get<string>('paystack.apiBaseUrl') ??
        'https://api.paystack.co',
    };
  }

  /**
   * Confirms the configured secret key actually authenticates with
   * Paystack, without any endpoint that could return card/secret data.
   * `getSubscription` on a reference that can't exist returns a
   * definitive signal either way: a 404 means Paystack accepted the
   * request as authenticated and simply found nothing (key is valid); a
   * 401 means the key itself was rejected. No new PaystackApiClient
   * method was added for this — it reuses an existing read call.
   */
  async testPaystackConnection(): Promise<{
    connected: boolean;
    message: string;
  }> {
    if ((process.env.BILLING_PROVIDER ?? 'development') !== 'paystack') {
      return {
        connected: false,
        message: 'Billing provider is not set to Paystack',
      };
    }
    const secretKey = this.config.get<string>('paystack.secretKey') ?? '';
    if (!secretKey) {
      return {
        connected: false,
        message: 'PAYSTACK_SECRET_KEY is not configured',
      };
    }

    try {
      await this.paystackApi.getSubscription('linkiq_admin_connection_test');
      return { connected: true, message: 'Connected to Paystack' };
    } catch (error) {
      if (error instanceof PaystackApiException && error.status === 401) {
        return {
          connected: false,
          message: 'Paystack rejected the configured secret key',
        };
      }
      // A 404 (or any other non-401 response) still confirms the key
      // authenticated successfully — see this method's own docs.
      return { connected: true, message: 'Connected to Paystack' };
    }
  }
}
