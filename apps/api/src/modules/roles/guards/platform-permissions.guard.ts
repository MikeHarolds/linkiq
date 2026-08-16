import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRole } from '@prisma/client';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Enforces platform-role permission checks — the product-entitlement
 * axis (see docs/architecture/roles-and-permissions.md). Mirrors
 * WorkspaceRolesGuard's shape exactly: a route with no
 * @RequirePermission() decorator is untouched by this guard (returns
 * true immediately), so adding this guard globally is safe without
 * retrofitting every existing route.
 *
 * GlobalRole.SUPER_ADMIN always passes, regardless of platformRole —
 * SUPER_ADMIN is unrestricted platform administrative authority (Part
 * 16/17 of the sprint spec), never gated by a product-entitlement
 * permission. This is the only special case; a workspace OWNER/ADMIN
 * gets no special treatment here at all — WorkspaceRole and
 * PermissionKey are unrelated axes.
 */
@Injectable()
export class PlatformPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication is required for this action');
    }

    if (user.globalRole === GlobalRole.SUPER_ADMIN) {
      return true;
    }

    if (!user.platformPermissions.includes(required as never)) {
      throw new ForbiddenException('Your current plan does not include access to this feature');
    }

    return true;
  }
}
