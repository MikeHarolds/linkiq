import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { WorkspaceRole } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';

import { WorkspacesService } from './workspaces.service';

const OWNER = 'OWNER' as WorkspaceRole;
const ADMIN = 'ADMIN' as WorkspaceRole;
const MEMBER = 'MEMBER' as WorkspaceRole;

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };

describe('WorkspacesService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let service: WorkspacesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new WorkspacesService(
      prisma as unknown as never,
      audit as unknown as AuditService,
    );
  });

  describe('create', () => {
    it('creates an organization + workspace and makes the caller OWNER', async () => {
      prisma.organization.create.mockResolvedValue({ id: 'org-1' });
      const workspace = { id: 'ws-1', name: 'Marketing Team', slug: 'main' };
      prisma.workspace.create.mockResolvedValue(workspace);
      prisma.workspaceMember.create.mockResolvedValue({});

      const result = await service.create(
        'user-1',
        { name: 'Marketing Team' },
        CTX,
      );

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            role: OWNER,
          }),
        }),
      );
      expect(result).toBe(workspace);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'workspace.created' }),
      );
    });
  });

  describe('findByIdOrThrow', () => {
    it('throws NotFoundException for a missing workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);
      await expect(service.findByIdOrThrow('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('inviteMember', () => {
    it('throws NotFoundException when no account exists for the email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteMember(
          'ws-1',
          'inviter-1',
          { email: 'nobody@example.com' },
          CTX,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the user is already a member', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'member-1' });

      await expect(
        service.inviteMember(
          'ws-1',
          'inviter-1',
          { email: 'existing@example.com' },
          CTX,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('adds the member with the requested role (defaulting to MEMBER) and audits it', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      const created = { id: 'member-2', role: MEMBER, user: {} };
      prisma.workspaceMember.create.mockResolvedValue(created);

      const result = await service.inviteMember(
        'ws-1',
        'inviter-1',
        { email: 'new@example.com' },
        CTX,
      );

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { workspaceId: 'ws-1', userId: 'user-2', role: MEMBER },
        }),
      );
      expect(result).toBe(created);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'workspace.member_invited' }),
      );
    });

    it('honors an explicitly requested ADMIN role', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      prisma.workspaceMember.create.mockResolvedValue({});

      await service.inviteMember(
        'ws-1',
        'inviter-1',
        {
          email: 'new@example.com',
          role: ADMIN as Exclude<WorkspaceRole, 'OWNER'>,
        },
        CTX,
      );

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: ADMIN }),
        }),
      );
    });
  });

  describe('removeMember — last-owner protection', () => {
    it('refuses to remove the sole owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-1',
        role: OWNER,
      });
      prisma.workspaceMember.count.mockResolvedValue(0); // no OTHER owners

      await expect(
        service.removeMember('ws-1', 'member-1', 'actor-1', CTX),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workspaceMember.delete).not.toHaveBeenCalled();
    });

    it('allows removing an owner when another owner remains', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-1',
        role: OWNER,
        userId: 'user-1',
      });
      prisma.workspaceMember.count.mockResolvedValue(1); // one other owner
      prisma.workspaceMember.delete.mockResolvedValue({});

      await service.removeMember('ws-1', 'member-1', 'actor-1', CTX);

      expect(prisma.workspaceMember.delete).toHaveBeenCalledWith({
        where: { id: 'member-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'workspace.member_removed' }),
      );
    });

    it('allows removing a non-owner without any owner check', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-2',
        workspaceId: 'ws-1',
        role: MEMBER,
        userId: 'user-2',
      });
      prisma.workspaceMember.delete.mockResolvedValue({});

      await service.removeMember('ws-1', 'member-2', 'actor-1', CTX);

      expect(prisma.workspaceMember.count).not.toHaveBeenCalled();
      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    it('throws NotFoundException for a member belonging to a different workspace', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-OTHER',
        role: MEMBER,
      });

      await expect(
        service.removeMember('ws-1', 'member-1', 'actor-1', CTX),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMemberRole — last-owner protection', () => {
    it('refuses to demote the sole owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-1',
        role: OWNER,
        userId: 'user-1',
      });
      prisma.workspaceMember.count.mockResolvedValue(0);

      await expect(
        service.updateMemberRole(
          'ws-1',
          'member-1',
          'actor-1',
          { role: ADMIN },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
    });

    it('allows promoting a member to OWNER without an owner-count check', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-2',
        workspaceId: 'ws-1',
        role: MEMBER,
        userId: 'user-2',
      });
      prisma.workspaceMember.update.mockResolvedValue({});

      await service.updateMemberRole(
        'ws-1',
        'member-2',
        'actor-1',
        { role: OWNER },
        CTX,
      );

      expect(prisma.workspaceMember.count).not.toHaveBeenCalled();
      expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: 'member-2' },
        data: { role: OWNER },
      });
    });
  });
});
