import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PlanTier, RoleAssignmentSource, SubscriptionStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { FREE_USER_ROLE_SLUG, RoleResolutionService } from './role-resolution.service';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makeSubRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: SubscriptionStatus.ACTIVE,
    trialEnd: null,
    cancelAt: null,
    pastDueSince: null,
    plan: {
      tier: PlanTier.PROFESSIONAL,
      platformRoleId: 'role-professional',
      platformRole: { id: 'role-professional', slug: 'professional-user', isActive: true },
    },
    ...overrides,
  };
}

describe('RoleResolutionService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let config: { get: jest.Mock };
  let service: RoleResolutionService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue(undefined) };
    service = new RoleResolutionService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      config as unknown as ConfigService,
    );
  });

  describe('resolveEffectiveRole', () => {
    it('returns the ADMIN_ASSIGNED override as-is, without ever looking at subscriptions', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        platformRoleId: 'role-enterprise-override',
        roleAssignmentSource: RoleAssignmentSource.ADMIN_ASSIGNED,
        platformRole: { id: 'role-enterprise-override', slug: 'enterprise-override', isActive: true },
      });

      const result = await service.resolveEffectiveRole('user-1');

      expect(result).toEqual({
        platformRoleId: 'role-enterprise-override',
        roleSlug: 'enterprise-override',
        source: RoleAssignmentSource.ADMIN_ASSIGNED,
        workspaceId: null,
      });
      expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled();
    });

    it('resolves from the highest-tier effectively-active plan among owned workspaces', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        platformRoleId: null,
        roleAssignmentSource: null,
        platformRole: null,
      });
      prisma.workspaceMember.findMany.mockResolvedValue([
        {
          workspace: {
            id: 'ws-starter',
            subscription: makeSubRow({
              plan: {
                tier: PlanTier.STARTER,
                platformRoleId: 'role-starter',
                platformRole: { id: 'role-starter', slug: 'starter-user', isActive: true },
              },
            }),
          },
        },
        {
          workspace: { id: 'ws-business', subscription: makeSubRow({ plan: { tier: PlanTier.BUSINESS, platformRoleId: 'role-business', platformRole: { id: 'role-business', slug: 'business-user', isActive: true } } }) } },
      ]);

      const result = await service.resolveEffectiveRole('user-1');

      expect(result.platformRoleId).toBe('role-business');
      expect(result.source).toBe(RoleAssignmentSource.SUBSCRIPTION);
      expect(result.workspaceId).toBe('ws-business');
    });

    it('skips a workspace whose subscription is not effectively active (expired trial)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        platformRoleId: null,
        roleAssignmentSource: null,
        platformRole: null,
      });
      prisma.workspaceMember.findMany.mockResolvedValue([
        {
          workspace: {
            id: 'ws-1',
            subscription: makeSubRow({
              status: SubscriptionStatus.TRIALING,
              trialEnd: new Date('2020-01-01'),
            }),
          },
        },
      ]);
      prisma.platformRole.findUnique.mockResolvedValue({ id: 'role-free', slug: FREE_USER_ROLE_SLUG });

      const result = await service.resolveEffectiveRole('user-1');

      expect(result.source).toBe(RoleAssignmentSource.SYSTEM_DEFAULT);
      expect(result.platformRoleId).toBe('role-free');
    });

    it('skips a plan whose attached role has been deactivated', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        platformRoleId: null,
        roleAssignmentSource: null,
        platformRole: null,
      });
      prisma.workspaceMember.findMany.mockResolvedValue([
        {
          workspace: {
            id: 'ws-1',
            subscription: makeSubRow({
              plan: {
                tier: PlanTier.PROFESSIONAL,
                platformRoleId: 'role-professional',
                platformRole: { id: 'role-professional', slug: 'professional-user', isActive: false },
              },
            }),
          },
        },
      ]);
      prisma.platformRole.findUnique.mockResolvedValue({ id: 'role-free', slug: FREE_USER_ROLE_SLUG });

      const result = await service.resolveEffectiveRole('user-1');

      expect(result.source).toBe(RoleAssignmentSource.SYSTEM_DEFAULT);
    });

    it('falls back to FREE_USER when the user owns no workspace at all', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        platformRoleId: null,
        roleAssignmentSource: null,
        platformRole: null,
      });
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.platformRole.findUnique.mockResolvedValue({ id: 'role-free', slug: FREE_USER_ROLE_SLUG });

      const result = await service.resolveEffectiveRole('user-1');

      expect(result).toEqual({
        platformRoleId: 'role-free',
        roleSlug: FREE_USER_ROLE_SLUG,
        source: RoleAssignmentSource.SYSTEM_DEFAULT,
        workspaceId: null,
      });
    });
  });

  describe('syncStoredRole', () => {
    it('is a no-op — no write, no audit — when the resolved role already matches what is stored', async () => {
      prisma.user.findUniqueOrThrow
        .mockResolvedValueOnce({ platformRoleId: 'role-free', roleAssignmentSource: RoleAssignmentSource.SYSTEM_DEFAULT })
        .mockResolvedValueOnce({ platformRoleId: null, roleAssignmentSource: RoleAssignmentSource.SYSTEM_DEFAULT, platformRole: null });
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.platformRole.findUnique.mockResolvedValue({ id: 'role-free', slug: FREE_USER_ROLE_SLUG });

      await service.syncStoredRole('user-1');

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('writes and audits when the resolved role differs from what is stored — repeated calls stay idempotent', async () => {
      prisma.user.findUniqueOrThrow
        .mockResolvedValueOnce({ platformRoleId: null, roleAssignmentSource: null })
        .mockResolvedValueOnce({ platformRoleId: null, roleAssignmentSource: null, platformRole: null });
      prisma.workspaceMember.findMany.mockResolvedValue([
        { workspace: { id: 'ws-1', subscription: makeSubRow() } },
      ]);

      const result = await service.syncStoredRole('user-1', ctx);

      expect(result.platformRoleId).toBe('role-professional');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { platformRoleId: 'role-professional', roleAssignmentSource: RoleAssignmentSource.SUBSCRIPTION },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'role.subscription_role_assigned' }),
      );
    });

    it('never overwrites an ADMIN_ASSIGNED override, even after a subscription change', async () => {
      prisma.user.findUniqueOrThrow
        .mockResolvedValueOnce({ platformRoleId: 'role-override', roleAssignmentSource: RoleAssignmentSource.ADMIN_ASSIGNED })
        .mockResolvedValueOnce({
          platformRoleId: 'role-override',
          roleAssignmentSource: RoleAssignmentSource.ADMIN_ASSIGNED,
          platformRole: { id: 'role-override', slug: 'override', isActive: true },
        });

      await service.syncStoredRole('user-1', ctx);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled();
    });
  });

  describe('assignManualRole', () => {
    it('sets the role and ADMIN_ASSIGNED source, and audits it', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', platformRoleId: 'role-free' });
      prisma.platformRole.findUnique.mockResolvedValue({ id: 'role-enterprise', slug: 'enterprise', isActive: true });

      const result = await service.assignManualRole('user-1', 'role-enterprise', 'admin-1', ctx);

      expect(result.source).toBe(RoleAssignmentSource.ADMIN_ASSIGNED);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { platformRoleId: 'role-enterprise', roleAssignmentSource: RoleAssignmentSource.ADMIN_ASSIGNED },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.user_role_assigned', userId: 'admin-1' }),
      );
    });

    it('rejects assigning an inactive role', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', platformRoleId: null });
      prisma.platformRole.findUnique.mockResolvedValue({ id: 'role-x', slug: 'x', isActive: false });

      await expect(service.assignManualRole('user-1', 'role-x', 'admin-1', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a nonexistent target user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.platformRole.findUnique.mockResolvedValue({ id: 'role-x', isActive: true });

      await expect(service.assignManualRole('missing', 'role-x', 'admin-1', ctx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('clearManualRole', () => {
    it('resolves from subscriptions again and audits the removal', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        platformRoleId: 'role-override',
        roleAssignmentSource: RoleAssignmentSource.ADMIN_ASSIGNED,
      });
      prisma.workspaceMember.findMany.mockResolvedValue([
        { workspace: { id: 'ws-1', subscription: makeSubRow() } },
      ]);

      const result = await service.clearManualRole('user-1', 'admin-1', ctx);

      expect(result.platformRoleId).toBe('role-professional');
      expect(result.source).toBe(RoleAssignmentSource.SUBSCRIPTION);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.user_role_override_removed', userId: 'admin-1' }),
      );
    });
  });
});
