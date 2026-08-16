import type { GlobalRole, PermissionKey } from '@prisma/client';

/**
 * Shape attached to `request.user` by JwtStrategy after successful token
 * validation. Deliberately excludes passwordHash and any other sensitive
 * field — this is what every @CurrentUser() consumer sees.
 *
 * platformRoleId/platformPermissions (Sprint 15) are populated by the
 * same per-request DB lookup JwtStrategy already performs for
 * isActive/globalRole — not a second query, and never encoded into the
 * JWT payload itself (see docs/architecture/roles-and-permissions.md's
 * Performance section on why a large/stale permission set has no
 * business living in a token that isn't re-validated until it expires).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  globalRole: GlobalRole;
  platformRoleId: string | null;
  platformPermissions: PermissionKey[];
}

/** Claims encoded in the access token JWT payload. */
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
}
