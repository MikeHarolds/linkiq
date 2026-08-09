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
});
