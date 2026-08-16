import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { GlobalRole, PermissionKey } from '@prisma/client';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { PlatformPermissionsGuard } from './platform-permissions.guard';

function makeContext(user?: Partial<AuthenticatedUser>): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('PlatformPermissionsGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: PlatformPermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PlatformPermissionsGuard(reflector as unknown as Reflector);
  });

  it('passes through untouched when the route has no @RequirePermission() decorator', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = makeContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('always allows a SUPER_ADMIN, regardless of platformPermissions', () => {
    reflector.getAllAndOverride.mockReturnValue(PermissionKey.BILLING_MANAGE);
    const context = makeContext({ globalRole: GlobalRole.SUPER_ADMIN, platformPermissions: [] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a user whose platformPermissions includes the required key', () => {
    reflector.getAllAndOverride.mockReturnValue(PermissionKey.ANALYTICS_ADVANCED);
    const context = makeContext({
      globalRole: GlobalRole.USER,
      platformPermissions: [PermissionKey.ANALYTICS_ADVANCED],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a user whose platformPermissions does not include the required key', () => {
    reflector.getAllAndOverride.mockReturnValue(PermissionKey.BILLING_MANAGE);
    const context = makeContext({ globalRole: GlobalRole.USER, platformPermissions: [PermissionKey.LINKS_VIEW] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request on a permission-gated route', () => {
    reflector.getAllAndOverride.mockReturnValue(PermissionKey.LINKS_VIEW);
    const context = makeContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
