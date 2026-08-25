import { Prisma } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { EmailService } from '../email/email.service';

import { ReportDispatchService } from './report-dispatch.service';
import type { ReportGenerationService } from './report-generation.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.20.0',
  });
}

describe('ReportDispatchService', () => {
  let prisma: MockPrismaService;
  let generation: { buildReportData: jest.Mock };
  let emailService: { queueEmail: jest.Mock };
  let service: ReportDispatchService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    generation = { buildReportData: jest.fn().mockResolvedValue({ reportPeriod: 'yesterday' }) };
    emailService = { queueEmail: jest.fn().mockResolvedValue('log-1') };
    service = new ReportDispatchService(
      prisma as unknown as never,
      generation as unknown as ReportGenerationService,
      emailService as unknown as EmailService,
    );

    prisma.userReportPreference.findMany.mockResolvedValue([]);
  });

  it('does nothing when no user is eligible this hour', async () => {
    await service.runTick('DAILY');
    expect(prisma.emailReportRun.create).not.toHaveBeenCalled();
  });

  it('dispatches a report for each eligible user and links the EmailLog back to the run', async () => {
    prisma.userReportPreference.findMany.mockResolvedValue([{ userId: 'user-1' }]);
    prisma.emailReportRun.create.mockResolvedValue({ id: 'run-1' });
    prisma.user.findUnique.mockResolvedValue({
      email: 'jane@example.com',
      firstName: 'Jane',
      isActive: true,
    });
    prisma.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-1' });
    prisma.emailReportRun.update.mockResolvedValue({});

    await service.runTick('DAILY');

    expect(prisma.emailReportRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', frequency: 'DAILY' }) }),
    );
    expect(generation.buildReportData).toHaveBeenCalledWith('ws-1', expect.anything());
    expect(emailService.queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        type: 'DAILY_REPORT',
        recipientUserId: 'user-1',
        referenceId: 'run-1',
      }),
    );
    expect(prisma.emailReportRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { emailLogId: 'log-1' },
    });
  });

  it('skips a user whose EmailReportRun already exists for this period (duplicate tick) without sending twice', async () => {
    prisma.userReportPreference.findMany.mockResolvedValue([{ userId: 'user-1' }]);
    prisma.emailReportRun.create.mockRejectedValue(uniqueViolation());

    await service.runTick('DAILY');

    expect(generation.buildReportData).not.toHaveBeenCalled();
    expect(emailService.queueEmail).not.toHaveBeenCalled();
  });

  it('isolates a per-user failure — one bad user does not abort the rest of the batch', async () => {
    prisma.userReportPreference.findMany.mockResolvedValue([
      { userId: 'user-bad' },
      { userId: 'user-good' },
    ]);
    prisma.emailReportRun.create
      .mockRejectedValueOnce(new Error('unexpected DB error'))
      .mockResolvedValueOnce({ id: 'run-2' });
    prisma.user.findUnique.mockResolvedValue({
      email: 'good@example.com',
      firstName: 'Good',
      isActive: true,
    });
    prisma.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-2' });
    prisma.emailReportRun.update.mockResolvedValue({});

    await service.runTick('DAILY');

    expect(emailService.queueEmail).toHaveBeenCalledTimes(1);
    expect(emailService.queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'good@example.com' }),
    );
  });

  it('skips a user who has no workspace at all', async () => {
    prisma.userReportPreference.findMany.mockResolvedValue([{ userId: 'user-1' }]);
    prisma.emailReportRun.create.mockResolvedValue({ id: 'run-1' });
    prisma.user.findUnique.mockResolvedValue({
      email: 'jane@example.com',
      firstName: 'Jane',
      isActive: true,
    });
    prisma.workspaceMember.findFirst.mockResolvedValue(null);

    await service.runTick('DAILY');

    expect(generation.buildReportData).not.toHaveBeenCalled();
    expect(emailService.queueEmail).not.toHaveBeenCalled();
  });
});
