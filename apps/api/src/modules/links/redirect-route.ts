import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RedirectService } from './redirect.service';

/**
 * Registers GET /:shortCode directly on the underlying HTTP adapter,
 * outside Nest's controller system entirely.
 *
 * Why not a normal @Controller() with setGlobalPrefix's `exclude` option:
 * that option matches its pattern against every incoming request path
 * before Nest's router runs. A param-style exclude entry like
 * `:shortCode` compiles to "any single path segment" — verified
 * empirically to also match `/health`, `/workspaces`, and `/links`,
 * silently stripping the /api/v1 prefix requirement from all of them
 * too. Registering this route directly on the Express instance, after
 * Nest's own routes are already mounted (call this after `app.init()`,
 * before `app.listen()`), sidesteps that matching entirely: Express
 * checks its already-registered /api/v1/* routes first, and only a path
 * that matches none of them reaches this handler.
 */
export function registerRedirectRoute(app: INestApplication): void {
  const redirectService = app.get(RedirectService);
  const httpAdapter = app.getHttpAdapter().getInstance();

  httpAdapter.get('/:shortCode', async (req: Request, res: Response) => {
    const shortCode = req.params.shortCode;
    if (!shortCode) {
      res.status(404).json({
        statusCode: 404,
        message: 'Short link not found',
        error: 'NOT_FOUND',
      });
      return;
    }

    const outcome = await redirectService.resolve(shortCode, {
      ipAddress: resolveClientIp(req),
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
    });

    res.setHeader('Cache-Control', 'no-store');

    switch (outcome.kind) {
      case 'redirect':
        // 302, not 301: the destination can change, and neither browsers
        // nor CDNs should be permitted to permanently cache the mapping.
        res.redirect(302, outcome.destinationUrl);
        return;
      case 'not_found':
        res.status(404).json({
          statusCode: 404,
          message: 'Short link not found',
          error: 'NOT_FOUND',
        });
        return;
      case 'paused':
        res.status(403).json({
          statusCode: 403,
          message: 'This link has been paused by its owner',
          error: 'LINK_PAUSED',
        });
        return;
      case 'expired':
        res.status(410).json({
          statusCode: 410,
          message: 'This link has expired',
          error: 'LINK_EXPIRED',
        });
        return;
      case 'archived':
        res.status(410).json({
          statusCode: 410,
          message: 'This link has been archived',
          error: 'LINK_ARCHIVED',
        });
        return;
    }
  });
}

/** Respects X-Forwarded-For when running behind the Nginx reverse proxy
 * (see infrastructure/nginx) — same convention as request-context.decorator.ts. */
function resolveClientIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (Array.isArray(forwardedFor)) return forwardedFor[0];
  if (typeof forwardedFor === 'string')
    return forwardedFor.split(',')[0]?.trim();
  return req.ip;
}
