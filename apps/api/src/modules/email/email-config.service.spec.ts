import { EmailLogType, type EmailConfiguration } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';

import { EmailConfigService, isEmailTypeEnabled } from './email-config.service';
import { EmailSecretCipherService } from './security/email-secret-cipher.service';

const SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

describe('EmailConfigService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let cipher: EmailSecretCipherService;
  let service: EmailConfigService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cipher = new EmailSecretCipherService({ get: () => 'test-key' } as never);
    service = new EmailConfigService(
      prisma as unknown as never,
      audit as unknown as AuditService,
      cipher,
    );
  });

  it('upserts on the fixed singleton id', async () => {
    prisma.emailConfiguration.upsert.mockResolvedValue({
      id: SINGLETON_ID,
      enabled: false,
    });
    await service.get();
    expect(prisma.emailConfiguration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SINGLETON_ID } }),
    );
  });

  it('caches the row for subsequent get() calls within the TTL', async () => {
    prisma.emailConfiguration.upsert.mockResolvedValue({
      id: SINGLETON_ID,
      enabled: false,
    });
    await service.get();
    await service.get();
    expect(prisma.emailConfiguration.upsert).toHaveBeenCalledTimes(1);
  });

  it('getMasked never includes ciphertext fields', async () => {
    prisma.emailConfiguration.upsert.mockResolvedValue({
      id: SINGLETON_ID,
      enabled: true,
      provider: 'RESEND',
      fromName: 'LinkIQ',
      fromEmail: 'noreply@linkiq.example',
      resendApiKeyPrefix: 're_1234…',
      resendApiKeyCiphertext: 'iv:tag:ciphertext',
      smtpHost: null,
      smtpPort: null,
      smtpUsername: null,
      smtpPasswordCiphertext: null,
      smtpEncryptionMode: 'TLS',
      requireEmailVerification: true,
      lastSuccessfulSendAt: null,
      lastFailedSendAt: null,
      lastConnectionTestAt: null,
      lastConnectionTestOk: null,
    });

    const snapshot = await service.getMasked();

    expect(snapshot).not.toHaveProperty('resendApiKeyCiphertext');
    expect(snapshot).not.toHaveProperty('smtpPasswordCiphertext');
    expect(snapshot.resendApiKeyConfigured).toBe(true);
    expect(snapshot.resendApiKeyPrefix).toBe('re_1234…');
  });

  it('update() encrypts a provided secret and redacts it from audit metadata', async () => {
    prisma.emailConfiguration.upsert.mockResolvedValue({
      id: SINGLETON_ID,
      enabled: true,
      provider: 'RESEND',
      fromName: 'LinkIQ',
      fromEmail: 'noreply@linkiq.example',
      resendApiKeyPrefix: 're_newkey…',
      resendApiKeyCiphertext: 'iv:tag:ciphertext',
      smtpEncryptionMode: 'TLS',
      requireEmailVerification: true,
    });

    await service.update({ resendApiKey: 're_new_secret_value' }, 'admin-1', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    const upsertCall = prisma.emailConfiguration.upsert.mock.calls[0][0];
    expect(upsertCall.update.resendApiKeyCiphertext).toBeDefined();
    expect(upsertCall.update.resendApiKeyCiphertext).not.toContain(
      're_new_secret_value',
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.email_config_updated',
      }),
    );
    const auditMetadata = audit.record.mock.calls[0][0].metadata;
    expect(JSON.stringify(auditMetadata)).not.toContain('re_new_secret_value');
    expect(auditMetadata.changes.resendApiKey).toBe('[redacted]');
  });

  it('omitting a secret on update leaves the stored ciphertext unchanged', async () => {
    prisma.emailConfiguration.upsert.mockResolvedValue({
      id: SINGLETON_ID,
      enabled: true,
    });

    await service.update({ fromName: 'New Name' }, 'admin-1', {
      ipAddress: undefined,
      userAgent: undefined,
    });

    const upsertCall = prisma.emailConfiguration.upsert.mock.calls[0][0];
    expect(upsertCall.update.resendApiKeyCiphertext).toBeUndefined();
    expect(upsertCall.update.fromName).toBe('New Name');
  });

  it('update() persists per-type toggle changes', async () => {
    prisma.emailConfiguration.upsert.mockResolvedValue({
      id: SINGLETON_ID,
      enabled: true,
    });

    await service.update(
      { welcomeEmailsEnabled: false, reportEmailsEnabled: false },
      'admin-1',
      { ipAddress: undefined, userAgent: undefined },
    );

    const upsertCall = prisma.emailConfiguration.upsert.mock.calls[0][0];
    expect(upsertCall.update.welcomeEmailsEnabled).toBe(false);
    expect(upsertCall.update.reportEmailsEnabled).toBe(false);
    expect(upsertCall.update.verificationEmailsEnabled).toBeUndefined();
  });
});

describe('isEmailTypeEnabled', () => {
  const baseConfig = {
    welcomeEmailsEnabled: true,
    verificationEmailsEnabled: true,
    passwordResetEmailsEnabled: true,
    reportEmailsEnabled: true,
  } as unknown as EmailConfiguration;

  it('gates WELCOME/VERIFICATION/PASSWORD_RESET/*_REPORT by their own flag', () => {
    expect(
      isEmailTypeEnabled(
        { ...baseConfig, welcomeEmailsEnabled: false },
        EmailLogType.WELCOME,
      ),
    ).toBe(false);
    expect(
      isEmailTypeEnabled(
        { ...baseConfig, verificationEmailsEnabled: false },
        EmailLogType.VERIFICATION,
      ),
    ).toBe(false);
    expect(
      isEmailTypeEnabled(
        { ...baseConfig, passwordResetEmailsEnabled: false },
        EmailLogType.PASSWORD_RESET,
      ),
    ).toBe(false);
    expect(
      isEmailTypeEnabled(
        { ...baseConfig, reportEmailsEnabled: false },
        EmailLogType.DAILY_REPORT,
      ),
    ).toBe(false);
    expect(
      isEmailTypeEnabled(
        { ...baseConfig, reportEmailsEnabled: false },
        EmailLogType.WEEKLY_REPORT,
      ),
    ).toBe(false);
  });

  it('TEST is always enabled regardless of other flags', () => {
    expect(
      isEmailTypeEnabled(
        {
          welcomeEmailsEnabled: false,
          verificationEmailsEnabled: false,
          passwordResetEmailsEnabled: false,
          reportEmailsEnabled: false,
        } as unknown as EmailConfiguration,
        EmailLogType.TEST,
      ),
    ).toBe(true);
  });
});
