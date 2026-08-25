import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProviderKind } from '@prisma/client';

import { EmailConfigService } from '../email-config.service';
import { EmailSecretCipherService } from '../security/email-secret-cipher.service';

import type { EmailProvider } from './email-provider.interface';
import { NullEmailProvider } from './null-email-provider';
import { ResendEmailProvider } from './resend-email-provider';
import { SmtpEmailProvider } from './smtp-email-provider';

/**
 * Resolves the live EmailProvider from the current EmailConfiguration —
 * called fresh on every send attempt (never cached across jobs), so a
 * mid-flight admin disable/reconfigure is always respected immediately,
 * the same "reload from Postgres on every attempt" discipline
 * WebhookDeliveryProcessor already uses for endpoint state.
 */
@Injectable()
export class EmailProviderFactory {
  constructor(
    private readonly emailConfig: EmailConfigService,
    private readonly cipher: EmailSecretCipherService,
    private readonly config: ConfigService,
  ) {}

  async resolve(): Promise<EmailProvider> {
    const cfg = await this.emailConfig.get();

    if (!cfg.enabled) {
      return new NullEmailProvider();
    }

    const timeoutMs = this.config.get<number>('email.timeoutMs') ?? 10000;

    if (cfg.provider === EmailProviderKind.RESEND) {
      if (!cfg.resendApiKeyCiphertext || !cfg.fromEmail) {
        return new NullEmailProvider();
      }
      return new ResendEmailProvider({
        apiKey: this.cipher.decrypt(cfg.resendApiKeyCiphertext),
        fromEmail: cfg.fromEmail,
        fromName: cfg.fromName,
        timeoutMs,
      });
    }

    if (
      !cfg.smtpHost ||
      !cfg.smtpPort ||
      !cfg.smtpUsername ||
      !cfg.smtpPasswordCiphertext ||
      !cfg.fromEmail
    ) {
      return new NullEmailProvider();
    }
    return new SmtpEmailProvider({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      username: cfg.smtpUsername,
      password: this.cipher.decrypt(cfg.smtpPasswordCiphertext),
      encryptionMode: cfg.smtpEncryptionMode,
      fromEmail: cfg.fromEmail,
      fromName: cfg.fromName,
      timeoutMs,
    });
  }
}
