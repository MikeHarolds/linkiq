import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';

import { SuperAdminGuard } from './super-admin.guard';

function makeContext(user?: { globalRole?: GlobalRole }): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  let guard: SuperAdminGuard;

  beforeEach(() => {
    guard = new SuperAdminGuard();
  });

  it('allows the request through when the user has GlobalRole.SUPER_ADMIN', () => {
    const context = makeContext({ globalRole: GlobalRole.SUPER_ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a regular USER', () => {
    const context = makeContext({ globalRole: GlobalRole.USER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when the request has no user at all (unauthenticated)', () => {
    const context = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when globalRole is missing on an otherwise-authenticated user', () => {
    const context = makeContext({});
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('never leaks internal detail in the error message', () => {
    const context = makeContext({ globalRole: GlobalRole.USER });
    try {
      guard.canActivate(context);
      fail('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toBe(
        'This action requires platform administrator access',
      );
    }
  });
});
