import { EmailProviderKind } from '@prisma/client';

import type {
  EmailProvider,
  EmailSendInput,
  EmailSendResult,
} from './email-provider.interface';

const RESEND_API_BASE = 'https://api.resend.com';

/** 429/5xx/network/timeout are retryable; every other 4xx (bad request,
 * unverified domain, invalid recipient, ...) is a permanent rejection —
 * same classification WebhookDeliveryProcessor.isRetryableStatus uses. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export interface ResendEmailProviderConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  timeoutMs: number;
}

/**
 * Resend's HTTPS API only — never SMTP (see §2/§18 of the Sprint 20
 * spec: Render Free must not depend on outbound SMTP for the demo
 * path). Raw `fetch`, the same request shape already established in
 * webhook-delivery.processor.ts, so no new HTTP client dependency is
 * introduced.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly kind = EmailProviderKind.RESEND;

  constructor(private readonly cfg: ResendEmailProviderConfig) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      this.cfg.timeoutMs,
    );

    try {
      const response = await fetch(`${RESEND_API_BASE}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${this.cfg.fromName} <${this.cfg.fromEmail}>`,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
        }),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      let parsed: { id?: string; message?: string } = {};
      try {
        parsed = bodyText ? (JSON.parse(bodyText) as typeof parsed) : {};
      } catch {
        // Resend always returns JSON; a non-JSON body means something
        // upstream (proxy, outage page) intercepted the request — fall
        // through to the generic error message below.
      }

      if (response.ok) {
        return { success: true, providerMessageId: parsed.id };
      }

      return {
        success: false,
        errorMessage:
          parsed.message ?? `Resend responded with HTTP ${response.status}`,
        retryable: isRetryableStatus(response.status),
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return {
        success: false,
        errorMessage: isAbort
          ? `Resend request timed out after ${this.cfg.timeoutMs}ms`
          : `Network error contacting Resend: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /** Cheap, read-only, authenticated call — a 401 means the key is
   * rejected, anything else (including an empty domain list) confirms
   * it authenticated. Same "one existing read call answers auth
   * validity" pattern as AdminSettingsService.testPaystackConnection. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(`${RESEND_API_BASE}/domains`, {
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      });
      if (response.status === 401) {
        return { ok: false, message: 'Resend rejected the configured API key' };
      }
      if (!response.ok) {
        return {
          ok: false,
          message: `Resend responded with HTTP ${response.status}`,
        };
      }
      return { ok: true, message: 'Connected to Resend' };
    } catch (error) {
      return {
        ok: false,
        message: `Network error contacting Resend: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
