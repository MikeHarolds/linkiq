import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { GlobalRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';

import { UsersService } from './users.service';

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const USER_ROLE = 'USER' as GlobalRole;

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    passwordHash: 'placeholder',
    firstName: 'Jane',
    lastName: 'Doe',
    avatarUrl: null,
    globalRole: USER_ROLE,
    isActive: true,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('UsersService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let config: { get: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn(() => 4) }; // low bcrypt rounds for fast tests
    service = new UsersService(
      prisma as unknown as never,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
  });

  describe('updateProfile', () => {
    it('updates only the provided fields and records an audit event', async () => {
      const updated = makeUser({ firstName: 'Janet' });
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.updateProfile(
        'user-1',
        { firstName: 'Janet' },
        CTX,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'Janet' },
      });
      expect(result).toBe(updated);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.profile_updated' }),
      );
    });
  });

  describe('changePassword', () => {
    it('rejects when the current password is incorrect', async () => {
      const correctHash = await bcrypt.hash('CorrectPassword1', 4);
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({ passwordHash: correctHash }),
      );

      await expect(
        service.changePassword(
          'user-1',
          {
            currentPassword: 'WrongPassword',
            newPassword: 'NewSecurePass123',
            newPasswordConfirmation: 'NewSecurePass123',
          },
          CTX,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.password_change_failed' }),
      );
    });

    it('on success: updates the password hash and revokes every active session', async () => {
      const correctHash = await bcrypt.hash('CorrectPassword1', 4);
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({ passwordHash: correctHash }),
      );
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.changePassword(
        'user-1',
        {
          currentPassword: 'CorrectPassword1',
          newPassword: 'NewSecurePass123',
          newPasswordConfirmation: 'NewSecurePass123',
        },
        CTX,
      );

      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.passwordHash).not.toBe('CorrectPassword1');
      expect(
        await bcrypt.compare('NewSecurePass123', updateCall.data.passwordHash),
      ).toBe(true);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.password_changed' }),
      );
    });
  });
});
