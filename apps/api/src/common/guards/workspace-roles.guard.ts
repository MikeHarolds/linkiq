import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  ApiKeyPermission,
  WorkspaceMember,
  WorkspaceRole,
} from '@prisma/client';
import type { Request } from 'express';

import { API_PERMISSION_KEY } from '../../common/decorators/api-permission.decorator';
import { ApiPermissionDeniedException } from '../../modules/api-keys/exceptions/api-permission-denied.exception';
import { WorkspaceAccessDeniedException } from '../../modules/api-keys/exceptions/workspace-access-denied.exception';
import type { ApiKeyAuthContext } from '../../modules/api-keys/types/api-key-auth-context.type';
import type { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { WORKSPACE_ROLES_KEY } from '../decorators/roles.decorator';
import { hasSufficientRole } from '../utils/role-hierarchy';

type GuardedRequest = Request & {
  user: AuthenticatedUser;
  apiKeyAuth?: ApiKeyAuthContext;
  workspaceMember?: WorkspaceMember;
};

/**
 * Enforces workspace-scoped authorization. Requires the route to be
 * behind the global JwtAuthGuard (so `request.user` is set) and decorated
 * with @Roles(...). Resolves the active workspace from the
 * `X-Workspace-Id` header, confirms the caller is a member, then checks
 * their role against the fixed OWNER > ADMIN > MEMBER > VIEWER hierarchy.
 *
 * On success, attaches the caller's WorkspaceMember row to the request so
 * handlers can read it via @CurrentWorkspace() without a second query.
 *
 * Sprint 8 — API-key branch: when `request.apiKeyAuth` is present (set by
 * JwtAuthGuard for a request authenticated via API key instead of a
 * browser session), the JWT membership/role path above is skipped
 * entirely in favor of a different check — see handleApiKeyAuth(). The
 * two branches are mutually exclusive (a request is authenticated by
 * exactly one method), so the original JWT logic is otherwise completely
 * unchanged.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<WorkspaceRole[]>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      // Route isn't workspace-scoped; nothing for this guard to enforce.
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();

    if (request.apiKeyAuth) {
      return this.handleApiKeyAuth(context, request, request.apiKeyAuth);
    }

    const workspaceId =
      (request.params.workspaceId as string | undefined) ??
      (request.headers['x-workspace-id'] as string | undefined);

    if (!workspaceId) {
      throw new ForbiddenException(
        'A workspace context is required for this request (X-Workspace-Id header or :workspaceId route param)',
      );
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: request.user.id,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    if (!hasSufficientRole(membership.role, requiredRoles)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action in this workspace',
      );
    }

    request.workspaceMember = membership;
    return true;
  }

  /**
   * The workspace is *always* the one encoded on the key — never the
   * X-Workspace-Id header, which is ignored entirely for API-key auth.
   * If the route has an explicit :workspaceId param (only
   * DomainsController, nested under /workspaces/:workspaceId/...) and it
   * disagrees with the key's workspace, the request is rejected outright
   * rather than silently redirected to the key's own workspace — a
   * caller-supplied workspace id must never be honored, matching or not.
   */
  private async handleApiKeyAuth(
    context: ExecutionContext,
    request: GuardedRequest,
    apiKeyAuth: ApiKeyAuthContext,
  ): Promise<boolean> {
    const routeWorkspaceId = request.params.workspaceId as string | undefined;
    if (routeWorkspaceId && routeWorkspaceId !== apiKeyAuth.workspaceId) {
      throw new WorkspaceAccessDeniedException();
    }

    const requiredPermission = this.reflector.getAllAndOverride<
      ApiKeyPermission | undefined
    >(API_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    // A route that was never annotated with @ApiPermission() is not
    // reachable via API key at all — fail closed rather than assume any
    // implicit scope.
    if (!requiredPermission) {
      throw new ApiPermissionDeniedException('none configured for this route');
    }

    if (!apiKeyAuth.permissions.includes(requiredPermission)) {
      throw new ApiPermissionDeniedException(requiredPermission);
    }

    request.workspaceMember = await this.resolveWorkspaceMember(apiKeyAuth);
    return true;
  }

  /** Reuses the key creator's real membership row when it still exists
   * (the common case), so @CurrentWorkspace() behaves identically to the
   * JWT path. Falls back to a minimal synthetic membership if the
   * creator has since left the workspace — the `role` field is inert for
   * an API-key request, since authorization already happened via
   * @ApiPermission, not @Roles. */
  private async resolveWorkspaceMember(
    apiKeyAuth: ApiKeyAuthContext,
  ): Promise<WorkspaceMember> {
    if (apiKeyAuth.createdById) {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: apiKeyAuth.workspaceId,
            userId: apiKeyAuth.createdById,
          },
        },
      });
      if (membership) {
        return membership;
      }
    }

    return {
      id: apiKeyAuth.apiKeyId,
      workspaceId: apiKeyAuth.workspaceId,
      userId: apiKeyAuth.createdById ?? apiKeyAuth.apiKeyId,
      role: 'MEMBER',
      createdAt: new Date(),
    } satisfies WorkspaceMember;
  }
}
