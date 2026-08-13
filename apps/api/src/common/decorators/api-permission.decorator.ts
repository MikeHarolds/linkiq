import { SetMetadata } from '@nestjs/common';
import type { ApiKeyPermission } from '@prisma/client';

export const API_PERMISSION_KEY = 'apiPermission';

/**
 * Declares which API-key scope a route requires, in parallel with the
 * existing @Roles(...) (which governs browser/JWT access to the same
 * route and is completely unaffected by this decorator). Enforced by
 * WorkspaceRolesGuard's API-key branch — see its docs.
 *
 * A route with no @ApiPermission() is simply unreachable by an API key
 * at all (fails closed): WorkspaceRolesGuard's API-key branch requires
 * this metadata to be present before it will authorize anything.
 *
 * @example
 * ```ts
 * @Roles('MEMBER')
 * @ApiPermission('LINKS_WRITE')
 * @Post()
 * create() { ... }
 * ```
 */
export const ApiPermission = (
  permission: ApiKeyPermission,
): MethodDecorator & ClassDecorator =>
  SetMetadata(API_PERMISSION_KEY, permission);
