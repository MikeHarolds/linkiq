import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { extractClientIp, getViaWebProxyTrustedHops } from '../utils/client-ip';

export interface RequestContext {
  ipAddress: string | undefined;
  userAgent: string | undefined;
}

/**
 * Extracts client IP + User-Agent for audit logging. Centralized here so
 * every module records this context the same way — see
 * common/utils/client-ip.ts for the actual trust-boundary logic (also
 * used by the redirect route), which this must stay identical to.
 *
 * Pass `@Ctx(true)` ONLY on a route that is always reached via this
 * app's own Next.js rewrite proxy in a split-hostname deployment (as
 * of this writing: auth's register/login/refresh — see
 * apps/web/src/providers/auth-provider.tsx's SAME_ORIGIN_API_PREFIX
 * calls) — see getViaWebProxyTrustedHops()'s own doc comment for why
 * that path needs a different trusted-hop count than every other
 * endpoint, which the browser always calls directly.
 */
export const Ctx = createParamDecorator(
  (viaWebProxy: boolean | undefined, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();

    return {
      ipAddress: extractClientIp(
        request.headers,
        request.socket.remoteAddress,
        viaWebProxy ? getViaWebProxyTrustedHops() : undefined,
      ),
      userAgent: request.headers['user-agent'],
    };
  },
);
