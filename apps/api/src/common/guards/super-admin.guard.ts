import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';

/**
 * Enforces platform-level (not workspace-level) authorization — the
 * SUPER_ADMIN branch of `User.globalRole`, distinct from and unrelated to
 * `WorkspaceRole`/`WorkspaceRolesGuard`. A workspace OWNER/ADMIN never
 * satisfies this guard, regardless of which workspace they own or how
 * many — `globalRole` and `WorkspaceRole` are two independent axes (see
 * docs/architecture/super-admin.md).
 *
 * Applied per-controller via `@UseGuards(SuperAdminGuard)` on every
 * `/admin/*` controller (not registered as a global APP_GUARD — most
 * routes in this app are workspace-scoped, not platform-scoped, and must
 * stay reachable by ordinary users). Requires the global JwtAuthGuard to
 * have already run and populated `request.user` — Nest runs
 * controller-level guards after global ones, so this is always true by
 * the time this guard executes; there is no @Public() admin route.
 *
 * Fails closed: an API-key-authenticated request (no `globalRole` at
 * all reachable via `request.user` in that shape being a real platform
 * user's own row is fine, but API keys are workspace-scoped credentials
 * and must never grant platform access) is rejected the same way a
 * regular user is, since `request.user.globalRole` for an API-key
 * request is still resolved from the *key's creator's own* User row —
 * if that user is a SUPER_ADMIN, so be it (same person, same privilege,
 * consistent with JwtAuthGuard's design of never treating an API key as
 * a distinct principal from its creator).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    if (request.user?.globalRole !== GlobalRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'This action requires platform administrator access',
      );
    }

    return true;
  }
}
