import { SetMetadata } from '@nestjs/common';
import type { WorkspaceRole } from '@prisma/client';

export const WORKSPACE_ROLES_KEY = 'workspaceRoles';

/**
 * Declares the minimum workspace role required to access a route.
 * Enforced by WorkspaceRolesGuard, which resolves the active workspace
 * from the `X-Workspace-Id` header and checks the caller's membership
 * role against a fixed hierarchy: OWNER > ADMIN > MEMBER > VIEWER.
 *
 * @example
 * ```ts
 * @Roles('ADMIN')
 * @Delete(':workspaceId/members/:memberId')
 * removeMember() { ... }
 * ```
 */
export const Roles = (
  ...roles: WorkspaceRole[]
): MethodDecorator & ClassDecorator => SetMetadata(WORKSPACE_ROLES_KEY, roles);
