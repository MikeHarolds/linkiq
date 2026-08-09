import type { GlobalRole } from '@prisma/client';

/**
 * Shape attached to `request.user` by JwtStrategy after successful token
 * validation. Deliberately excludes passwordHash and any other sensitive
 * field — this is what every @CurrentUser() consumer sees.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  globalRole: GlobalRole;
}

/** Claims encoded in the access token JWT payload. */
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
}
