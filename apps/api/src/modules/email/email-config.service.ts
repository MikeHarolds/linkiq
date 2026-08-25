import { Injectable } from '@nestjs/common';
import { EmailLogType, Prisma, type EmailConfiguration } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { EmailSecretCipherService } from './security/email-secret-cipher.service';

/** Fixed id for the single EmailConfiguration row — SiteBranding already
 * owns '...0001', same enforced-singleton pattern (see that model's own
 * doc comment in schema.prisma for why this lives in application logic
 * rather than a schema-level constraint). */
const SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

const CACHE_TTL_MS = 60 * 1000;

export interface EmailConfigSnapshot {
  enabled: boolean;
  provider: EmailConfiguration['provider'];
  fromName: string;
  fromEmail: string;
  resendApiKeyConfigured: boolean;
  resendApiKeyPrefix: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpPasswordConfigured: boolean;
  smtpEncryptionMode: EmailConfiguration['smtpEncryptionMode'];
  requireEmailVerification: boolean;
  welcomeEmailsEnabled: boolean;
  verificationEmailsEnabled: boolean;
  passwordResetEmailsEnabled: boolean;
  reportEmailsEnabled: boolean;
  lastSuccessfulSendAt: Date | null;
  lastFailedSendAt: Date | null;
  lastConnectionTestAt: Date | null;
  lastConnectionTestOk: boolean | null;
}

/**
 * Admin-writable singleton holding the platform's transactional-email
 * configuration — structurally mirrors BrandingService (60s cache,
 * upsert-on-fixed-id, cache invalidated on every write, AuditService.record
 * on every mutation). Secrets (resendApiKeyCiphertext/
 * smtpPasswordCiphertext) are encrypted via EmailSecretCipherService and
 * NEVER appear in getMasked()'s output or in audit metadata — see §2/§3/
 * §15 of the Sprint 20 spec.
 */
@Injectable()
export class EmailConfigService {
  private cache: { config: EmailConfiguration; expiresAt: number } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cipher: EmailSecretCipherService,
  ) {}

  async get(): Promise<EmailConfiguration> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.config;
    }
    const config = await this.prisma.emailConfiguration.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
    this.cache = { config, expiresAt: now + CACHE_TTL_MS };
    return config;
  }

  async getMasked(): Promise<EmailConfigSnapshot> {
    const config = await this.get();
    return {
      enabled: config.enabled,
      provider: config.provider,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      resendApiKeyConfigured: Boolean(config.resendApiKeyCiphertext),
      resendApiKeyPrefix: config.resendApiKeyPrefix,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpUsername: config.smtpUsername,
      smtpPasswordConfigured: Boolean(config.smtpPasswordCiphertext),
      smtpEncryptionMode: config.smtpEncryptionMode,
      requireEmailVerification: config.requireEmailVerification,
      welcomeEmailsEnabled: config.welcomeEmailsEnabled,
      verificationEmailsEnabled: config.verificationEmailsEnabled,
      passwordResetEmailsEnabled: config.passwordResetEmailsEnabled,
      reportEmailsEnabled: config.reportEmailsEnabled,
      lastSuccessfulSendAt: config.lastSuccessfulSendAt,
      lastFailedSendAt: config.lastFailedSendAt,
      lastConnectionTestAt: config.lastConnectionTestAt,
      lastConnectionTestOk: config.lastConnectionTestOk,
    };
  }

  async update(
    dto: UpdateEmailConfigDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<EmailConfigSnapshot> {
    const data: Partial<{
      enabled: boolean;
      provider: EmailConfiguration['provider'];
      fromName: string;
      fromEmail: string;
      requireEmailVerification: boolean;
      welcomeEmailsEnabled: boolean;
      verificationEmailsEnabled: boolean;
      passwordResetEmailsEnabled: boolean;
      reportEmailsEnabled: boolean;
      smtpHost: string;
      smtpPort: number;
      smtpUsername: string;
      smtpEncryptionMode: EmailConfiguration['smtpEncryptionMode'];
      resendApiKeyCiphertext: string;
      resendApiKeyPrefix: string;
      smtpPasswordCiphertext: string;
    }> = {};

    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.fromName !== undefined) data.fromName = dto.fromName;
    if (dto.fromEmail !== undefined) data.fromEmail = dto.fromEmail;
    if (dto.requireEmailVerification !== undefined) {
      data.requireEmailVerification = dto.requireEmailVerification;
    }
    if (dto.welcomeEmailsEnabled !== undefined) {
      data.welcomeEmailsEnabled = dto.welcomeEmailsEnabled;
    }
    if (dto.verificationEmailsEnabled !== undefined) {
      data.verificationEmailsEnabled = dto.verificationEmailsEnabled;
    }
    if (dto.passwordResetEmailsEnabled !== undefined) {
      data.passwordResetEmailsEnabled = dto.passwordResetEmailsEnabled;
    }
    if (dto.reportEmailsEnabled !== undefined) {
      data.reportEmailsEnabled = dto.reportEmailsEnabled;
    }
    if (dto.smtpHost !== undefined) data.smtpHost = dto.smtpHost;
    if (dto.smtpPort !== undefined) data.smtpPort = dto.smtpPort;
    if (dto.smtpUsername !== undefined) data.smtpUsername = dto.smtpUsername;
    if (dto.smtpEncryptionMode !== undefined) {
      data.smtpEncryptionMode = dto.smtpEncryptionMode;
    }

    if (dto.resendApiKey) {
      data.resendApiKeyCiphertext = this.cipher.encrypt(dto.resendApiKey);
      data.resendApiKeyPrefix = EmailSecretCipherService.derivePrefix(
        dto.resendApiKey,
      );
    }
    if (dto.smtpPassword) {
      data.smtpPasswordCiphertext = this.cipher.encrypt(dto.smtpPassword);
    }

    await this.prisma.emailConfiguration.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
    this.cache = null;

    // Redact secret fields before they ever reach audit metadata — the
    // spec's own hard requirement (§2/§15): never log a key/password.
    const {
      resendApiKey: _resendApiKey,
      smtpPassword: _smtpPassword,
      ...safeDto
    } = dto;
    await this.audit.record({
      action: 'admin.email_config_updated',
      entity: 'EmailConfiguration',
      entityId: SINGLETON_ID,
      userId: adminUserId,
      metadata: JSON.parse(
        JSON.stringify({
          changes: {
            ...safeDto,
            resendApiKey: dto.resendApiKey ? '[redacted]' : undefined,
            smtpPassword: dto.smtpPassword ? '[redacted]' : undefined,
          },
        }),
      ) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.getMasked();
  }

  async recordConnectionTestResult(
    ok: boolean,
    _message: string,
  ): Promise<void> {
    await this.prisma.emailConfiguration.update({
      where: { id: SINGLETON_ID },
      data: { lastConnectionTestAt: new Date(), lastConnectionTestOk: ok },
    });
    this.cache = null;
  }

  async recordSuccessfulSend(): Promise<void> {
    await this.prisma.emailConfiguration.update({
      where: { id: SINGLETON_ID },
      data: { lastSuccessfulSendAt: new Date() },
    });
    this.cache = null;
  }

  async recordFailedSend(): Promise<void> {
    await this.prisma.emailConfiguration.update({
      where: { id: SINGLETON_ID },
      data: { lastFailedSendAt: new Date() },
    });
    this.cache = null;
  }
}

/** Per-type kill switch lookup (§17) — TEST emails bypass this (they're
 * an explicit admin action gated only by the master `enabled` flag), so
 * they're always considered enabled here. */
export function isEmailTypeEnabled(
  config: EmailConfiguration,
  type: EmailLogType,
): boolean {
  switch (type) {
    case EmailLogType.WELCOME:
      return config.welcomeEmailsEnabled;
    case EmailLogType.VERIFICATION:
      return config.verificationEmailsEnabled;
    case EmailLogType.PASSWORD_RESET:
      return config.passwordResetEmailsEnabled;
    case EmailLogType.DAILY_REPORT:
    case EmailLogType.WEEKLY_REPORT:
      return config.reportEmailsEnabled;
    case EmailLogType.TEST:
      return true;
    default:
      return true;
  }
}
