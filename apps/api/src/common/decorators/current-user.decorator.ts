import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';

/**
 * Extracts the authenticated user attached to the request by JwtStrategy.
 * Only usable on routes protected by the (default, global) JwtAuthGuard.
 *
 * @example
 * ```ts
 * getMe(@CurrentUser() user: AuthenticatedUser) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
