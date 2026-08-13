import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { WorkspaceRole } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';

import { WorkspaceRolesGuard } from './workspace-roles.guard';

const OWNER = 'OWNER' as WorkspaceRole;
const ADMIN = 'ADMIN' as WorkspaceRole;
const MEMBER = 'MEMBER' as WorkspaceRole;
const VIEWER = 'VIEWER' as WorkspaceRole;

function makeContext(
  overrides: Partial<{
    params: Record<string, string>;
    headers: Record<string, string>;
    user: { id: string };
  }> = {},
): ExecutionContext {
  const request = {
    params: overrides.params ?? {},
    headers: overrides.headers ?? {},
    user: overrides.user ?? { id: 'user-1' },
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('WorkspaceRolesGuard', () => {
  let prisma: MockPrismaService;
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: WorkspaceRolesGuard;

  beforeEach(() => {
    prisma = createMockPrismaService();
    reflector = { getAllAndOverride: jest.fn() };
    guard = new WorkspaceRolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as never,
    );
  });

  it('allows the request through when the route has no @Roles() metadata', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const context = makeContext();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when no workspace context is provided', async () => {
    reflector.getAllAndOverride.mockReturnValue([VIEWER]);
    const context = makeContext(); // no params.workspaceId, no header

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the caller is not a member of the workspace', async () => {
    reflector.getAllAndOverride.mockReturnValue([VIEWER]);
    prisma.workspaceMember.findUnique.mockResolvedValue(null);

    const context = makeContext({ params: { workspaceId: 'ws-1' } });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('You are not a member of this workspace'),
    );
  });

  it('rejects when the caller has an insufficient role', async () => {
    reflector.getAllAndOverride.mockReturnValue([ADMIN]);
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'member-1',
      role: MEMBER,
    });

    const context = makeContext({ params: { workspaceId: 'ws-1' } });
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the request and attaches the membership when the role is sufficient', async () => {
    reflector.getAllAndOverride.mockReturnValue([ADMIN]);
    const membership = { id: 'member-1', role: OWNER };
    prisma.workspaceMember.findUnique.mockResolvedValue(membership);

    const request = {
      params: { workspaceId: 'ws-1' },
      headers: {},
      user: { id: 'user-1' },
    } as unknown as { workspaceMember?: unknown };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.workspaceMember).toBe(membership);
  });

  it('resolves the workspace from the X-Workspace-Id header when no route param is present', async () => {
    reflector.getAllAndOverride.mockReturnValue([VIEWER]);
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'member-1',
      role: VIEWER,
    });

    const context = makeContext({ headers: { 'x-workspace-id': 'ws-header' } });
    await guard.canActivate(context);

    expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_userId: { workspaceId: 'ws-header', userId: 'user-1' },
      },
    });
  });

  describe('API-key branch (Sprint 8)', () => {
    const apiKeyAuth = {
      authenticationType: 'api_key' as const,
      apiKeyId: 'key-1',
      workspaceId: 'ws-1',
      createdById: 'user-1',
      permissions: ['LINKS_READ'],
    };

    function makeApiKeyContext(
      overrides: Partial<{
        params: Record<string, string>;
        rolesMeta: unknown;
        permissionMeta: unknown;
      }> = {},
    ) {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'workspaceRoles') return overrides.rolesMeta ?? [VIEWER];
        if (key === 'apiPermission')
          return 'permissionMeta' in overrides
            ? overrides.permissionMeta
            : 'LINKS_READ';
        return undefined;
      });

      const request = {
        params: overrides.params ?? {},
        headers: {},
        user: { id: 'user-1' },
        apiKeyAuth,
      };

      return {
        context: {
          switchToHttp: () => ({ getRequest: () => request }),
          getHandler: () => undefined,
          getClass: () => undefined,
        } as unknown as ExecutionContext,
        request,
      };
    }

    it('grants access when the key has the required permission', async () => {
      const { context } = makeApiKeyContext();
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        role: OWNER,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('denies access when the key lacks the required permission', async () => {
      const { context } = makeApiKeyContext({ permissionMeta: 'LINKS_WRITE' });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    it('denies access when the route has no @ApiPermission at all (fails closed)', async () => {
      const { context } = makeApiKeyContext({ permissionMeta: undefined });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("rejects when a route :workspaceId param disagrees with the key's own workspace", async () => {
      const { context } = makeApiKeyContext({
        params: { workspaceId: 'ws-DIFFERENT' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    it('allows a matching :workspaceId route param', async () => {
      const { context } = makeApiKeyContext({
        params: { workspaceId: 'ws-1' },
      });
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        role: OWNER,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('ignores any X-Workspace-Id header entirely — the key is the only source of truth', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'workspaceRoles' ? [VIEWER] : 'LINKS_READ',
      );
      const request = {
        params: {},
        headers: { 'x-workspace-id': 'ws-attacker-supplied' },
        user: { id: 'user-1' },
        apiKeyAuth,
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as unknown as ExecutionContext;
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        role: OWNER,
      });

      await guard.canActivate(context);

      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId_userId: expect.objectContaining({
              workspaceId: 'ws-1',
            }),
          }),
        }),
      );
    });

    it("attaches the key creator's real membership to the request when it still exists", async () => {
      const { context, request } = makeApiKeyContext();
      const membership = {
        id: 'member-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        role: OWNER,
      };
      prisma.workspaceMember.findUnique.mockResolvedValue(membership);

      await guard.canActivate(context);

      expect(
        (request as unknown as { workspaceMember: unknown }).workspaceMember,
      ).toBe(membership);
    });

    it('synthesizes a minimal membership when the creator has left the workspace', async () => {
      const { context, request } = makeApiKeyContext();
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await guard.canActivate(context);

      const synthesized = (
        request as unknown as {
          workspaceMember: { workspaceId: string; userId: string };
        }
      ).workspaceMember;
      expect(synthesized.workspaceId).toBe('ws-1');
      expect(synthesized.userId).toBe('user-1');
    });
  });
});
