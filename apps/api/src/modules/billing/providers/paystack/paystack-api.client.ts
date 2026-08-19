import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaystackApiException } from './paystack-api.exception';

/** Every Paystack REST response is wrapped in this envelope regardless
 * of endpoint. `status` here is Paystack's own business-level success
 * flag — distinct from (and checked in addition to) the HTTP status
 * code, since a 200 can still carry `status: false`. */
interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface PaystackCustomer {
  customerCode: string;
  email: string;
}

export interface InitializeTransactionInput {
  email: string;
  /** Smallest currency unit (e.g. kobo for NGN) — Paystack requires
   * amount × 100, never a decimal major-unit value. */
  amountKobo: number;
  reference: string;
  /** Sprint 18B §17 — the ISO 4217 code Paystack should charge in.
   * LinkIQ's own Invoice amount/currency are authoritative for
   * checkout (see docs/architecture/paystack-integration.md §17) —
   * this is always sent explicitly now, never left for Paystack to
   * infer from a `plan` code, which could silently drift from what
   * LinkIQ actually invoiced (the exact bug this field exists to
   * prevent — see that doc's worked example). */
  currency: string;
  /** A Paystack plan_code — DEPRECATED as of Sprint 18B for the
   * invoice-first checkout flow (see PaystackBillingProvider
   * .createCheckoutSession, which no longer sets this): passing both
   * `plan` and `amount` lets Paystack silently use the PLAN's own
   * stored price instead of `amount`, which is exactly the drift
   * Sprint 18B eliminates. Kept on the interface only because
   * `PaystackApiClient` is a thin, provider-shaped wrapper — not
   * because any current caller sets it. */
  planCode?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifyTransactionResult {
  /** Paystack's own status string (e.g. "success", "failed",
   * "abandoned") — deliberately not narrowed to a union here, since
   * callers (PaystackBillingProvider) are the ones that decide which
   * values mean what for LinkIQ's state machine. */
  status: string;
  reference: string;
  amountKobo: number;
  /** Sprint 18A — Paystack's own ISO 4217 code for this transaction,
   * needed to independently verify it matches the originating
   * Invoice's currency (Part 6/11) rather than trusting the amount
   * alone. */
  currency: string | null;
  customerCode: string | null;
  authorizationCode: string | null;
  planCode: string | null;
  paidAt: Date | null;
  /** Echoed back exactly as sent on initializeTransaction — carries
   * `workspaceId`/`planSlug` so callers can resolve which LinkIQ
   * workspace this transaction belongs to without a separate lookup. */
  metadata: Record<string, unknown> | null;
}

export interface PaystackSubscriptionSnapshot {
  subscriptionCode: string;
  status: string;
  nextPaymentDate: Date | null;
}

export interface CreatePlanInput {
  name: string;
  amountKobo: number;
  interval: 'monthly' | 'annually';
  currency?: string;
}

export interface CreateSubscriptionInput {
  customerCode: string;
  planCode: string;
  /** Omit to let Paystack use the customer's most recently used
   * authorization. */
  authorization?: string;
}

export interface PaystackSubscription {
  subscriptionCode: string;
  emailToken: string;
  status: string;
}

export interface CreateRefundInput {
  transactionReference: string;
  /** Omit for a full refund; include for a partial one. */
  amountKobo?: number;
}

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Thin HTTP wrapper around the subset of Paystack's REST API LinkIQ
 * needs. Every method here maps Paystack's snake_case wire shapes onto
 * LinkIQ-conventional camelCase types — this is the ONLY file in the
 * codebase that should know Paystack's raw JSON field names.
 * PaystackBillingProvider is the only caller.
 */
@Injectable()
export class PaystackApiClient {
  private readonly logger = new Logger(PaystackApiClient.name);

  constructor(private readonly config: ConfigService) {}

  private get secretKey(): string {
    return this.config.get<string>('paystack.secretKey') ?? '';
  }

  private get baseUrl(): string {
    return (
      this.config.get<string>('paystack.apiBaseUrl') ??
      'https://api.paystack.co'
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      throw new PaystackApiException(
        isAbort
          ? `Paystack request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Paystack network error: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    let envelope: PaystackEnvelope<T> | undefined;
    try {
      envelope = (await response.json()) as PaystackEnvelope<T>;
    } catch {
      envelope = undefined;
    }

    if (!response.ok || !envelope || envelope.status !== true) {
      // Never log the request body/headers here — they carry the
      // secret key on every call.
      this.logger.warn(
        `Paystack ${method} ${path} failed: HTTP ${response.status}${
          envelope?.message ? ` — ${envelope.message}` : ''
        }`,
      );
      throw new PaystackApiException(
        envelope?.message ??
          `Paystack request failed with HTTP ${response.status}`,
        response.status,
      );
    }

    return envelope.data;
  }

  async createCustomer(
    email: string,
    metadata?: Record<string, unknown>,
  ): Promise<PaystackCustomer> {
    const data = await this.request<{ customer_code: string; email: string }>(
      'POST',
      '/customer',
      { email, metadata },
    );
    return { customerCode: data.customer_code, email: data.email };
  }

  async initializeTransaction(
    input: InitializeTransactionInput,
  ): Promise<InitializeTransactionResult> {
    const data = await this.request<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountKobo,
      currency: input.currency,
      reference: input.reference,
      plan: input.planCode,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });
    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      reference: data.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    const data = await this.request<{
      status: string;
      reference: string;
      amount: number;
      currency?: string | null;
      customer?: { customer_code?: string } | null;
      authorization?: { authorization_code?: string } | null;
      plan?: string | null;
      paid_at?: string | null;
      metadata?: Record<string, unknown> | null;
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

    return {
      status: data.status,
      reference: data.reference,
      amountKobo: data.amount,
      currency: data.currency ?? null,
      customerCode: data.customer?.customer_code ?? null,
      authorizationCode: data.authorization?.authorization_code ?? null,
      planCode: data.plan ?? null,
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      metadata: data.metadata ?? null,
    };
  }

  /** Returns null for a subscription code Paystack doesn't recognize
   * (404) rather than throwing — callers treat "unknown to Paystack"
   * as a normal, checkable outcome, not an error. */
  async getSubscription(
    subscriptionCode: string,
  ): Promise<PaystackSubscriptionSnapshot | null> {
    try {
      const data = await this.request<{
        subscription_code: string;
        status: string;
        next_payment_date?: string | null;
      }>('GET', `/subscription/${encodeURIComponent(subscriptionCode)}`);
      return {
        subscriptionCode: data.subscription_code,
        status: data.status,
        nextPaymentDate: data.next_payment_date
          ? new Date(data.next_payment_date)
          : null,
      };
    } catch (error) {
      if (error instanceof PaystackApiException && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async createPlan(input: CreatePlanInput): Promise<{ planCode: string }> {
    const data = await this.request<{ plan_code: string }>('POST', '/plan', {
      name: input.name,
      amount: input.amountKobo,
      interval: input.interval,
      currency: input.currency,
    });
    return { planCode: data.plan_code };
  }

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<PaystackSubscription> {
    const data = await this.request<{
      subscription_code: string;
      email_token: string;
      status: string;
    }>('POST', '/subscription', {
      customer: input.customerCode,
      plan: input.planCode,
      authorization: input.authorization,
    });
    return {
      subscriptionCode: data.subscription_code,
      emailToken: data.email_token,
      status: data.status,
    };
  }

  async disableSubscription(
    subscriptionCode: string,
    emailToken: string,
  ): Promise<void> {
    await this.request('POST', '/subscription/disable', {
      code: subscriptionCode,
      token: emailToken,
    });
  }

  async createRefund(input: CreateRefundInput): Promise<void> {
    await this.request('POST', '/refund', {
      transaction: input.transactionReference,
      amount: input.amountKobo,
    });
  }
}
