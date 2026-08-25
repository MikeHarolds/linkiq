import type {
  EmailProvider,
  EmailSendInput,
  EmailSendResult,
} from './email-provider.interface';

/**
 * The "disabled" no-op EmailProviderFactory resolves to whenever
 * EmailConfiguration.enabled is false. Never makes a network call —
 * this is what lets EmailService.queueEmail/the delivery processor
 * "skip jobs gracefully" (§4) without special-casing the disabled
 * state at every call site.
 */
export class NullEmailProvider implements EmailProvider {
  readonly kind = null;

  async send(_input: EmailSendInput): Promise<EmailSendResult> {
    return {
      success: false,
      retryable: false,
      errorMessage: 'Email service is disabled by an administrator',
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: false, message: 'Email service is disabled' };
  }
}
