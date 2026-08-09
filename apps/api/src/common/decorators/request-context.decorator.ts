import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestContext {
  ipAddress: string | undefined;
  userAgent: string | undefined;
}

/**
 * Extracts client IP + User-Agent for audit logging. Centralized here so
 * every module records this context the same way (respects X-Forwarded-For
 * when running behind a reverse proxy — see infrastructure/nginx).
 */
export const Ctx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const forwardedFor = request.headers['x-forwarded-for'];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : (forwardedFor?.split(',')[0]?.trim() ?? request.ip);

    return {
      ipAddress,
      userAgent: request.headers['user-agent'],
    };
  },
);
