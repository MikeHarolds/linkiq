import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import type { AuditService } from '../../audit/audit.service';
import type { AuthService } from '../../auth/auth.service';

import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let authService: { revokeAllSessions: jest.Mock };
  let service: AdminUsersService;

  const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    authService = { revokeAllSessions: jest.fn().mockResolvedValue(undefined) };
    service = new AdminUsersService(
      prisma as unknown as never,
      audit as unknown as AuditService,
      authService as unknown as AuthService,
    );
  });

  describe('list', () => {
    it('paginates users and attaches derived lastLoginAt from audit logs', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          email: 'a@test.com',
          firstName: 'A',
          lastName: 'One',
          avatarUrl: null,
          globalRole: 'USER',
          isActive: true,
          emailVerified: true,
          createdAt: new Date('2026-01-01'),
          _count: { memberships: 2 },
        },
      ]);
      prisma.user.count.mockResolvedValue(1);
      const lastLogin = new Date('2026-08-01');
      prisma.auditLog.groupBy.mockResolvedValue([
        { userId: 'u1', _max: { createdAt: lastLogin } },
      ]);

      const result = await service.list({ page: 1, pageSize: 20 } as never);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'u1',
        workspaceCount: 2,
        lastLoginAt: lastLogin,
      });
      expect(result.pagination.totalItems).toBe(1);
      // Never a plaintext password/secret field on the returned shape.
      expect(result.items[0]).not.toHaveProperty('passwordHash');
    });

    it('returns null lastLoginAt for a user who has never logged in', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u2',
          email: 'b@test.com',
          firstName: 'B',
          lastName: 'Two',
          avatarUrl: null,
          globalRole: 'USER',
          isActive: true,
          emailVerified: false,
          createdAt: new Date(),
          _count: { memberships: 0 },
        },
      ]);
      prisma.user.count.mockResolvedValue(1);
      prisma.auditLog.groupBy.mockResolvedValue([]);

      const result = await service.list({ page: 1, pageSize: 20 } as never);
      expect(result.items[0]!.lastLoginAt).toBeNull();
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('includes workspace/subscription context for an existing user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@test.com',
        firstName: 'A',
        lastName: 'One',
        avatarUrl: null,
        globalRole: 'USER',
        isActive: true,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { memberships: 1 },
      });
      prisma.workspaceMember.findMany.mockResolvedValue([
        {
          role: 'OWNER',
          workspace: {
            id: 'ws1',
            name: 'Acme',
            slug: 'acme',
            subscription: {
              status: 'ACTIVE',
              plan: { name: 'Starter', slug: 'starter' },
            },
          },
        },
      ]);
      prisma.auditLog.groupBy.mockResolvedValue([]);

      const result = await service.getDetail('u1');
      expect(result.workspaces).toEqual([
        {
          id: 'ws1',
          name: 'Acme',
          slug: 'acme',
          role: 'OWNER',
          planName: 'Starter',
          planSlug: 'starter',
          subscriptionStatus: 'ACTIVE',
        },
      ]);
    });
  });

  describe('suspend', () => {
    it('blocks a Super Admin from suspending their own account', async () => {
      await expect(service.suspend('u1', 'u1', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing target user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.suspend('missing', 'admin1', ctx)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivates the account, revokes all sessions, and records an audit entry', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@test.com',
      });

      await service.suspend('u1', 'admin1', ctx);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { isActive: false },
      });
      expect(authService.revokeAllSessions).toHaveBeenCalledWith('u1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.user_suspended',
          entity: 'User',
          entityId: 'u1',
          userId: 'admin1',
        }),
      );
    });
  });

  describe('reactivate', () => {
    it('throws NotFoundException for a missing target user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.reactivate('missing', 'admin1', ctx),
      ).rejects.toThrow(NotFoundException);
    });

    it('re-enables the account and records an audit entry', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@test.com',
      });

      await service.reactivate('u1', 'admin1', ctx);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { isActive: true },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.user_reactivated',
          entityId: 'u1',
        }),
      );
    });
  });

  describe('forceLogout', () => {
    it('revokes sessions without touching isActive, and audits it', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@test.com',
      });

      await service.forceLogout('u1', 'admin1', ctx);

      expect(authService.revokeAllSessions).toHaveBeenCalledWith('u1');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.user_force_logout',
          entityId: 'u1',
        }),
      );
    });
  });

  describe('getUserAuditActivity', () => {
    it('paginates a user’s own audit trail', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'a1',
          action: 'auth.login_succeeded',
          entity: 'User',
          createdAt: new Date(),
          metadata: null,
        },
      ]);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getUserAuditActivity('u1', 1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.pagination.totalItems).toBe(1);
    });
  });
});
