import {
  HttpException,
  HttpStatus,
  Injectable,
  type ExecutionContext,
} from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';

import type { ApiKeyAuthContext } from '../../modules/api-keys/types/api-key-auth-context.type';

/**
 * Extends the existing global ThrottlerGuard (see app.module.ts) rather
 * than introducing a second rate-limiting system — same ThrottlerModule
 * config, same storage, same env vars (THROTTLE_TTL/THROTTLE_LIMIT), same
 * per-route @Throttle(...) overrides already used by auth.controller.ts.
 *
 * The only change: an API-key-authenticated request is tracked by its
 * apiKeyId rather than source IP, so a key's rate limit follows it across
 * networks and is isolated from any browser session sharing the same NAT
 * — without that, many developers behind one office IP would share a
 * single bucket. Browser/JWT traffic (no `request.apiKeyAuth`) buckets by
 * IP exactly as before.
 */
@Injectable()
export class ApiKeyAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Request & { apiKeyAuth?: ApiKeyAuthContext },
  ): Promise<string> {
    return req.apiKeyAuth?.apiKeyId ?? req.ip ?? 'unknown';
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { apiKeyAuth?: ApiKeyAuthContext }>();

    if (!request.apiKeyAuth) {
      // Browser/JWT traffic keeps the library's existing behavior —
      // already covered by test/rate-limit.e2e-spec.ts.
      await super.throwThrottlingException(context, throttlerLimitDetail);
      return;
    }

    throw new HttpException(
      {
        code: 'API_RATE_LIMIT_EXCEEDED',
        message:
          'Too many requests with this API key. Please slow down and try again shortly.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
