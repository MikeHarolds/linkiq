import {
  EmailLogStatus,
  EmailLogType,
  EmailProviderKind,
} from '@prisma/client';
import type { Job } from 'bullmq';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/mocks/prisma.mock';
import type { EmailConfigService } from '../email-config.service';
import type { EmailProviderFactory } from '../providers/email-provider.factory';
import type { EmailRendererService } from '../templates/email-renderer.service';

import { EmailDeliveryProcessor } from './email-delivery.processor';
import type { SendEmailJobData } from './email-delivery.types';

function makeJob(
  data: SendEmailJobData,
  { attemptsMade = 0, attempts = 5 } = {},
): Job<SendEmailJobData> {
  return {
    data,
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<SendEmailJobData>;
}

describe('EmailDeliveryProcessor', () => {
  let prisma: MockPrismaService;
  let providerFactory: { resolve: jest.Mock };
  let renderer: { render: jest.Mock };
  let emailConfig: {
    recordSuccessfulSend: jest.Mock;
    recordFailedSend: jest.Mock;
  };
  let processor: EmailDeliveryProcessor;

  beforeEach(() => {
    prisma = createMockPrismaService();
    providerFactory = { resolve: jest.fn() };
    renderer = {
      render: jest
        .fn()
        .mockResolvedValue({ subject: 'Subject', html: '<p>Body</p>' }),
    };
    emailConfig = {
      recordSuccessfulSend: jest.fn().mockResolvedValue(undefined),
      recordFailedSend: jest.fn().mockResolvedValue(undefined),
    };
    prisma.emailLog.update.mockResolvedValue({});

    processor = new EmailDeliveryProcessor(
      prisma as unknown as never,
      providerFactory as unknown as EmailProviderFactory,
      renderer as unknown as EmailRendererService,
      emailConfig as unknown as EmailConfigService,
    );
  });

  it('discards the job when the log row no longer exists', async () => {
    prisma.emailLog.findUnique.mockResolvedValue(null);
    await processor.process(makeJob({ emailLogId: 'missing' }));
    expect(providerFactory.resolve).not.toHaveBeenCalled();
  });

  it('marks the log SENT on a successful send', async () => {
    prisma.emailLog.findUnique.mockResolvedValue({
      id: 'log-1',
      type: EmailLogType.WELCOME,
      recipientEmail: 'user@example.com',
      metadata: { firstName: 'Jane' },
    });
    providerFactory.resolve.mockResolvedValue({
      kind: EmailProviderKind.RESEND,
      send: jest
        .fn()
        .mockResolvedValue({ success: true, providerMessageId: 'msg_1' }),
    });

    await processor.process(makeJob({ emailLogId: 'log-1' }));

    expect(prisma.emailLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EmailLogStatus.SENT }),
      }),
    );
    expect(emailConfig.recordSuccessfulSend).toHaveBeenCalled();
  });

  it('rethrows (for BullMQ to retry) on a retryable failure that has not exhausted attempts', async () => {
    prisma.emailLog.findUnique.mockResolvedValue({
      id: 'log-2',
      type: EmailLogType.PASSWORD_RESET,
      recipientEmail: 'user@example.com',
      metadata: {},
    });
    providerFactory.resolve.mockResolvedValue({
      kind: EmailProviderKind.RESEND,
      send: jest.fn().mockResolvedValue({
        success: false,
        retryable: true,
        errorMessage: '429',
      }),
    });

    await expect(
      processor.process(
        makeJob({ emailLogId: 'log-2' }, { attemptsMade: 0, attempts: 5 }),
      ),
    ).rejects.toThrow('429');

    expect(prisma.emailLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EmailLogStatus.QUEUED }),
      }),
    );
    expect(emailConfig.recordFailedSend).not.toHaveBeenCalled();
  });

  it('marks the log FAILED (terminal) once attempts are exhausted', async () => {
    prisma.emailLog.findUnique.mockResolvedValue({
      id: 'log-3',
      type: EmailLogType.PASSWORD_RESET,
      recipientEmail: 'user@example.com',
      metadata: {},
    });
    providerFactory.resolve.mockResolvedValue({
      kind: EmailProviderKind.RESEND,
      send: jest.fn().mockResolvedValue({
        success: false,
        retryable: true,
        errorMessage: 'still failing',
      }),
    });

    await processor.process(
      makeJob({ emailLogId: 'log-3' }, { attemptsMade: 4, attempts: 5 }),
    );

    expect(prisma.emailLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EmailLogStatus.FAILED }),
      }),
    );
    expect(emailConfig.recordFailedSend).toHaveBeenCalled();
  });

  it('marks the log FAILED immediately on a non-retryable failure, regardless of attempts remaining', async () => {
    prisma.emailLog.findUnique.mockResolvedValue({
      id: 'log-4',
      type: EmailLogType.PASSWORD_RESET,
      recipientEmail: 'user@example.com',
      metadata: {},
    });
    providerFactory.resolve.mockResolvedValue({
      kind: EmailProviderKind.RESEND,
      send: jest.fn().mockResolvedValue({
        success: false,
        retryable: false,
        errorMessage: 'bad address',
      }),
    });

    await processor.process(
      makeJob({ emailLogId: 'log-4' }, { attemptsMade: 0, attempts: 5 }),
    );

    expect(prisma.emailLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EmailLogStatus.FAILED }),
      }),
    );
  });
});
