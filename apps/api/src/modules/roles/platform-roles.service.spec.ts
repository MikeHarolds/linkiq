import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PermissionKey } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { PlatformRolesService } from './platform-roles.service';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makeRoleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'role-1',
    name: 'Growth Partner',
    slug: 'growth-partner',
    description: null,
    isSystem: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    permissions: [{ permission: PermissionKey.LINKS_VIEW }],
    plans: [],
    _count: { users: 0, plans: 0 },
    ...overrides,
  };
}

describe('PlatformRolesService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let service: PlatformRolesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new PlatformRolesService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  });

  describe('create', () => {
    it('creates a custom role with its permissions and audits it', async () => {
      prisma.platformRole.findFirst.mockResolvedValue(null);
      prisma.platformRole.create.mockResolvedValue(makeRoleRow());
      prisma.platformRole.findUnique.mockResolvedValue(makeRoleRow());

      const result = await service.create(
        { name: 'Growth Partner', slug: 'growth-partner', permissions: [PermissionKey.LINKS_VIEW] },
        'admin-1',
        ctx,
      );

      expect(result.name).toBe('Growth Partner');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.role_created', userId: 'admin-1' }),
      );
    });

    it('rejects a reserved slug', async () => {
      await expect(
        service.create({ name: 'Fake Admin', slug: 'super-admin' }, 'admin-1', ctx),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.platformRole.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a duplicate name or slug', async () => {
      prisma.platformRole.findFirst.mockResolvedValue(makeRoleRow());

      await expect(
        service.create({ name: 'Growth Partner', slug: 'growth-partner-2' }, 'admin-1', ctx),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('replaces permissions and audits the change', async () => {
      prisma.platformRole.findUnique
        .mockResolvedValueOnce(makeRoleRow())
        .mockResolvedValueOnce(makeRoleRow({ permissions: [{ permission: PermissionKey.LINKS_EDIT }] }));

      await service.update('role-1', { permissions: [PermissionKey.LINKS_EDIT] }, 'admin-1', ctx);

      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { platformRoleId: 'role-1' } });
      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
        data: [{ platformRoleId: 'role-1', permission: PermissionKey.LINKS_EDIT }],
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.role_updated' }));
    });

    it('audits a deactivation separately from the general update', async () => {
      prisma.platformRole.findUnique
        .mockResolvedValueOnce(makeRoleRow({ isActive: true }))
        .mockResolvedValueOnce(makeRoleRow({ isActive: false }));

      await service.update('role-1', { isActive: false }, 'admin-1', ctx);

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.role_deactivated' }));
    });

    it('throws for a missing role', async () => {
      prisma.platformRole.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {}, 'admin-1', ctx)).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('rejects deleting a system role regardless of dependents', async () => {
      prisma.platformRole.findUnique.mockResolvedValue(
        makeRoleRow({ isSystem: true, _count: { users: 0, plans: 0 } }),
      );

      await expect(service.delete('role-1', 'admin-1', ctx)).rejects.toThrow(BadRequestException);
      expect(prisma.platformRole.delete).not.toHaveBeenCalled();
    });

    it('rejects deleting a custom role that still has assigned users or plans', async () => {
      prisma.platformRole.findUnique.mockResolvedValue(
        makeRoleRow({ isSystem: false, _count: { users: 3, plans: 0 } }),
      );

      await expect(service.delete('role-1', 'admin-1', ctx)).rejects.toThrow(BadRequestException);
      expect(prisma.platformRole.delete).not.toHaveBeenCalled();
    });

    it('deletes a custom role with zero dependents and audits it', async () => {
      prisma.platformRole.findUnique.mockResolvedValue(
        makeRoleRow({ isSystem: false, _count: { users: 0, plans: 0 } }),
      );

      await service.delete('role-1', 'admin-1', ctx);

      expect(prisma.platformRole.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.role_archived' }));
    });
  });
});
