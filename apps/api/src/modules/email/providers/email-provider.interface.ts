import type { EmailProviderKind } from '@prisma/client';

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  /** 429/5xx/network/timeout => true, 4xx validation/auth => false —
   * mirrors WebhookDeliveryProcessor's isRetryableStatus classification. */
  retryable?: boolean;
}

/**
 * The abstraction EmailService and the delivery processor depend on —
 * never a concrete provider directly. Implementations: ResendEmailProvider
 * (HTTPS API, the Render-Free demo path), SmtpEmailProvider (nodemailer),
 * NullEmailProvider (the disabled no-op EmailProviderFactory resolves to
 * whenever EmailConfiguration.enabled is false).
 */
export interface EmailProvider {
  readonly kind: EmailProviderKind | null;
  send(input: EmailSendInput): Promise<EmailSendResult>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
