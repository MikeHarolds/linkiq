import { EmailProviderKind, SmtpEncryptionMode } from '@prisma/client';
import * as nodemailer from 'nodemailer';

import type {
  EmailProvider,
  EmailSendInput,
  EmailSendResult,
} from './email-provider.interface';

export interface SmtpEmailProviderConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  encryptionMode: SmtpEncryptionMode;
  fromEmail: string;
  fromName: string;
  timeoutMs: number;
}

/**
 * The alternative provider (§3) — only ever imported/instantiated here,
 * never on the Render-Free demo path (Resend, §2/§18). `nodemailer` is
 * this sprint's one new runtime dependency, needed because there is no
 * way to speak SMTP from Node without either hand-rolling the protocol
 * or a library.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly kind = EmailProviderKind.SMTP;
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly cfg: SmtpEmailProviderConfig) {
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.encryptionMode === SmtpEncryptionMode.SSL,
      requireTLS: cfg.encryptionMode === SmtpEncryptionMode.TLS,
      auth: { user: cfg.username, pass: cfg.password },
      connectionTimeout: cfg.timeoutMs,
      greetingTimeout: cfg.timeoutMs,
      socketTimeout: cfg.timeoutMs,
    });
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: `${this.cfg.fromName} <${this.cfg.fromEmail}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return { success: true, providerMessageId: info.messageId };
    } catch (error) {
      return {
        success: false,
        errorMessage: this.describeError(error),
        retryable: this.isRetryable(error),
      };
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.transporter.verify();
      return { ok: true, message: 'Connected to SMTP server' };
    } catch (error) {
      return { ok: false, message: this.describeError(error) };
    }
  }

  /** Never includes the password — `describeError` only ever reads
   * `.message`/`.code` off the thrown error, and nodemailer never puts
   * credentials into either. */
  private describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /** Connection/timeout/greylisting errors are transient; auth failures
   * and permanently-rejected recipients are not. */
  private isRetryable(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    if (code === 'EAUTH') return false;
    if (
      code &&
      ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNRESET'].includes(code)
    ) {
      return true;
    }
    const responseCode = (error as { responseCode?: number })?.responseCode;
    if (typeof responseCode === 'number') {
      return responseCode >= 400 && responseCode < 500 && responseCode !== 550;
    }
    return true;
  }
}
