import type { ApiKeyPermission } from '@prisma/client';

/**
 * Attached to `request.apiKeyAuth` by JwtAuthGuard when a request
 * authenticates via an API key instead of a browser JWT session.
 * Deliberately a separate shape from AuthenticatedUser (see
 * types/authenticated-user.type.ts) — `request.user` still holds the
 * key's real creator (so @CurrentUser()/audit logs are unchanged), while
 * this object carries only what's specific to API-key auth. A request has
 * this set if and only if it was authenticated via an API key.
 */
export interface ApiKeyAuthContext {
  authenticationType: 'api_key';
  apiKeyId: string;
  workspaceId: string;
  createdById: string | null;
  permissions: ApiKeyPermission[];
}
