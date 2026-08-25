import { EmailLogStatus, EmailLogType } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';

import type { EmailConfigService } from './email-config.service';
import { EmailService } from './email.service';
import type { EmailDeliveryProducer } from './queue/email-delivery.producer';

describe('EmailService', () => {
  let prisma: MockPrismaService;
  let emailConfig: { get: jest.Mock };
  let producer: { enqueue: jest.Mock };
  let service: EmailService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    emailConfig = { get: jest.fn() };
    producer = { enqueue: jest.fn() };
    service = new EmailService(
      prisma as unknown as never,
      emailConfig as unknown as EmailConfigService,
      producer as unknown as EmailDeliveryProducer,
    );
  });

  it('writes a SKIPPED log and never enqueues when the service is disabled', async () => {
    emailConfig.get.mockResolvedValue({ enabled: false });
    prisma.emailLog.create.mockResolvedValue({ id: 'log-1' });

    const result = await service.queueEmail({
      to: 'user@example.com',
      type: EmailLogType.WELCOME,
      templateVars: { firstName: 'Jane' },
    });

    expect(result).toBe('log-1');
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EmailLogStatus.SKIPPED,
          failureReason: 'Email service is disabled by an administrator',
        }),
      }),
    );
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('writes a QUEUED log and enqueues when the service is enabled', async () => {
    emailConfig.get.mockResolvedValue({
      enabled: true,
      verificationEmailsEnabled: true,
    });
    prisma.emailLog.create.mockResolvedValue({ id: 'log-2' });

    const result = await service.queueEmail({
      to: 'user@example.com',
      type: EmailLogType.VERIFICATION,
      recipientUserId: 'user-1',
      templateVars: { verificationUrl: 'https://x/verify' },
    });

    expect(result).toBe('log-2');
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EmailLogStatus.QUEUED }),
      }),
    );
    expect(producer.enqueue).toHaveBeenCalledWith({ emailLogId: 'log-2' });
  });

  it('writes a SKIPPED log and never enqueues when that email type is disabled', async () => {
    emailConfig.get.mockResolvedValue({
      enabled: true,
      welcomeEmailsEnabled: false,
    });
    prisma.emailLog.create.mockResolvedValue({ id: 'log-3' });

    const result = await service.queueEmail({
      to: 'user@example.com',
      type: EmailLogType.WELCOME,
      templateVars: { firstName: 'Jane' },
    });

    expect(result).toBe('log-3');
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EmailLogStatus.SKIPPED,
          failureReason: 'WELCOME emails are disabled by an administrator',
        }),
      }),
    );
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('TEST emails bypass the per-type toggles', async () => {
    emailConfig.get.mockResolvedValue({ enabled: true });
    prisma.emailLog.create.mockResolvedValue({ id: 'log-4' });

    const result = await service.queueEmail({
      to: 'user@example.com',
      type: EmailLogType.TEST,
      templateVars: {},
    });

    expect(result).toBe('log-4');
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EmailLogStatus.QUEUED }),
      }),
    );
    expect(producer.enqueue).toHaveBeenCalledWith({ emailLogId: 'log-4' });
  });

  it('never throws — swallows and logs a Prisma failure', async () => {
    emailConfig.get.mockRejectedValue(new Error('DB is down'));

    await expect(
      service.queueEmail({
        to: 'user@example.com',
        type: EmailLogType.TEST,
        templateVars: {},
      }),
    ).resolves.toBeNull();

    expect(producer.enqueue).not.toHaveBeenCalled();
  });
});
