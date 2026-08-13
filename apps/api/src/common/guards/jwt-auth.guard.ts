import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { looksLikeApiKey } from '../../common/utils/api-key';
import { ApiKeysAuthService } from '../../modules/api-keys/api-keys-auth.service';
import type { ApiKeyAuthContext } from '../../modules/api-keys/types/api-key-auth-context.type';
import type { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Applied globally (see auth.module.ts APP_GUARD provider). Every route is
 * protected by default — opt out with @Public() rather than opting in per
 * route, so a forgotten decorator fails closed, not open.
 *
 * Dual-mode authentication (Sprint 8): a Bearer token is routed to either
 * browser-JWT auth (Passport, unchanged) or API-key auth (a plain method
 * call, not a second Passport strategy) based on a cheap prefix check —
 * `lk_live_` never collides with a JWT's three-dot-separated shape. This
 * is a manual branch rather than Passport's multi-strategy support
 * specifically so the two auth methods can populate the request
 * differently: JWT sets only `request.user`; an API key sets
 * `request.user` (the key's real creator, so @CurrentUser() and audit
 * logs are unaffected) *and* `request.apiKeyAuth` (workspaceId,
 * apiKeyId, permissions — see WorkspaceRolesGuard, which is the layer
 * that actually authorizes on this). Never overloads the JWT user object
 * with API-specific fields, and never converts an API key into a JWT.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeysAuth: ApiKeysAuthService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user?: AuthenticatedUser; apiKeyAuth?: ApiKeyAuthContext }
      >();

    const bearerToken = extractBearerToken(request);
    if (bearerToken && looksLikeApiKey(bearerToken)) {
      const { user, apiKeyAuth } =
        await this.apiKeysAuth.authenticate(bearerToken);
      request.user = user;
      request.apiKeyAuth = apiKeyAuth;
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice('Bearer '.length);
}
