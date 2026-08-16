import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@prisma/client';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Declares the platform permission required to access a route — the
 * product-entitlement axis, distinct from @Roles() (workspace-scoped)
 * and SuperAdminGuard (platform-administration-scoped). See
 * docs/architecture/roles-and-permissions.md for the full three-axis
 * model. Enforced by PlatformPermissionsGuard.
 *
 * @example
 * ```ts
 * @RequirePermission('ANALYTICS_ADVANCED')
 * @Get(':workspaceId/analytics/advanced')
 * getAdvancedAnalytics() { ... }
 * ```
 */
export const RequirePermission = (permission: PermissionKey): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
