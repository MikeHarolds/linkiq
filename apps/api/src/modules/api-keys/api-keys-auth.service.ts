import { Injectable } from '@nestjs/common';

import { hashToken } from '../../common/utils/token';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';

import { ApiKeyExpiredException } from './exceptions/api-key-expired.exception';
import { ApiKeyRevokedException } from './exceptions/api-key-revoked.exception';
import { InvalidApiKeyException } from './exceptions/invalid-api-key.exception';
import type { ApiKeyAuthContext } from './types/api-key-auth-context.type';

export interface ApiKeyAuthResult {
  user: AuthenticatedUser;
  apiKeyAuth: ApiKeyAuthContext;
}

/**
 * Validates a raw API key and resolves the request context for it —
 * the API-key equivalent of JwtStrategy.validate(). Called directly from
 * JwtAuthGuard (not a Passport strategy — see the guard's docs for why a
 * plain prefix-routed branch is simpler and keeps request.user's shape
 * unambiguous) whenever the Bearer token looks like an API key rather
 * than a JWT.
 *
 * Deliberately uncached: a single indexed lookup by keyHash is the same
 * cost class as JwtStrategy's own per-request, uncached user lookup, and
 * skipping a cache entirely means revocation is instant by construction
 * — see docs/architecture/api-keys.md §Performance.
 */
@Injectable()
export class ApiKeysAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(rawKey: string): Promise<ApiKeyAuthResult> {
    const keyHash = hashToken(rawKey);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { createdBy: true },
    });

    if (!apiKey) {
      throw new InvalidApiKeyException();
    }
    if (apiKey.revokedAt) {
      throw new ApiKeyRevokedException();
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
      throw new ApiKeyExpiredException();
    }
    if (!apiKey.createdBy || !apiKey.createdBy.isActive) {
      // Mirrors JwtStrategy's identical handling of a deleted/deactivated
      // user — fail closed with the same generic invalid-credential error
      // rather than a distinct code that would leak account state.
      throw new InvalidApiKeyException();
    }

    // Fire-and-forget: never let a write add latency to the auth path, and
    // never let a failure here block an otherwise-valid request.
    this.prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    const user: AuthenticatedUser = {
      id: apiKey.createdBy.id,
      email: apiKey.createdBy.email,
      firstName: apiKey.createdBy.firstName,
      lastName: apiKey.createdBy.lastName,
      globalRole: apiKey.createdBy.globalRole,
      platformRoleId: apiKey.createdBy.platformRoleId,
      // API-key auth resolves authorization entirely through
      // ApiKeyAuthContext.permissions (a separate, workspace-scoped
      // concept — see WorkspaceRolesGuard.handleApiKeyAuth) — never
      // through platformPermissions, which no API-key-reachable route
      // checks this sprint.
      platformPermissions: [],
      // Sprint 16 — API-key-authenticated requests never resolve a
      // currency preference (no browser session to apply it to); always
      // null, same treatment as platformPermissions above.
      preferredCurrencyCode: null,
    };

    return {
      user,
      apiKeyAuth: {
        authenticationType: 'api_key',
        apiKeyId: apiKey.id,
        workspaceId: apiKey.workspaceId,
        createdById: apiKey.createdById,
        permissions: apiKey.permissions,
      },
    };
  }
}
