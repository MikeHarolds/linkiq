import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { WorkspaceRole } from '@prisma/client';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { WORKSPACE_ROLES_KEY } from '../decorators/roles.decorator';
import { hasSufficientRole } from '../utils/role-hierarchy';

/**
 * Enforces workspace-scoped RBAC. Requires the route to be behind the
 * global JwtAuthGuard (so `request.user` is set) and decorated with
 * @Roles(...). Resolves the active workspace from the `X-Workspace-Id`
 * header, confirms the caller is a member, then checks their role against
 * the fixed OWNER > ADMIN > MEMBER > VIEWER hierarchy.
 *
 * On success, attaches the caller's WorkspaceMember row to the request so
 * handlers can read it via @CurrentWorkspace() without a second query.
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

    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user: AuthenticatedUser; workspaceMember?: unknown }
      >();

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
}
