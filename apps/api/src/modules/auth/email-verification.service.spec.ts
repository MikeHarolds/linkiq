import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { EmailService } from '../email/email.service';

import { EmailVerificationService } from './email-verification.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    firstName: 'Jane',
    emailVerified: false,
    ...overrides,
  } as User;
}

describe('EmailVerificationService', () => {
  let prisma: MockPrismaService;
  let config: { get: jest.Mock };
  let emailService: { queueEmail: jest.Mock };
  let service: EmailVerificationService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    config = { get: jest.fn().mockReturnValue(24) };
    emailService = { queueEmail: jest.fn().mockResolvedValue('log-1') };
    service = new EmailVerificationService(
      prisma as unknown as never,
      config as unknown as ConfigService,
      emailService as unknown as EmailService,
    );
  });

  describe('issueAndSend', () => {
    it('creates a hashed, expiring token and queues a VERIFICATION email', async () => {
      prisma.emailVerificationToken.create.mockResolvedValue({});

      const url = await service.issueAndSend(makeUser());

      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
      const createdData =
        prisma.emailVerificationToken.create.mock.calls[0][0].data;
      expect(createdData.tokenHash).toHaveLength(64); // sha256 hex
      expect(createdData.tokenHash).not.toContain(url.split('token=')[1]);

      expect(emailService.queueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          type: 'VERIFICATION',
        }),
      );
      expect(url).toContain('/verify-email?token=');
    });
  });

  describe('verify', () => {
    it('flips emailVerified and marks the token used on success', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await service.verify('raw-token');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { emailVerified: true },
        }),
      );
      expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'token-1' } }),
      );
    });

    it('rejects an unknown token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
      await expect(service.verify('nope')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an already-used token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.verify('used')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      });
      await expect(service.verify('expired')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('resendVerification', () => {
    it('silently no-ops for an already-verified user', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );

      await service.resendVerification('user-1');

      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
      expect(emailService.queueEmail).not.toHaveBeenCalled();
    });

    it('silently no-ops for a non-existent user (no enumeration signal)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await service.resendVerification('ghost');
      expect(emailService.queueEmail).not.toHaveBeenCalled();
    });

    it('invalidates prior unused tokens and issues a fresh one for an unverified user', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: false }),
      );
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.emailVerificationToken.create.mockResolvedValue({});

      await service.resendVerification('user-1');

      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', usedAt: null },
        }),
      );
      expect(emailService.queueEmail).toHaveBeenCalled();
    });
  });
});
