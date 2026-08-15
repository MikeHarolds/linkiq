import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { extractClientIp } from '../utils/client-ip';

export interface RequestContext {
  ipAddress: string | undefined;
  userAgent: string | undefined;
}

/**
 * Extracts client IP + User-Agent for audit logging. Centralized here so
 * every module records this context the same way — see
 * common/utils/client-ip.ts for the actual trust-boundary logic (also
 * used by the redirect route), which this must stay identical to.
 */
export const Ctx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();

    return {
      ipAddress: extractClientIp(request.headers, request.socket.remoteAddress),
      userAgent: request.headers['user-agent'],
    };
  },
);
