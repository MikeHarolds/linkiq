import { Logger, type INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';

import { extractClientIp } from '../../common/utils/client-ip';

import { RedirectService } from './redirect.service';

// TEMPORARY diagnostic for the Sprint 13 Render attribution investigation
// (Unknown country / Direct referrer on the real Render deployment).
// Logs only the proxy-chain headers and the resolved client IP needed to
// verify TRUSTED_PROXY_HOPS against Render's actual edge topology — never
// cookies, tokens, passwords, or any other secret. Remove once root-caused.
const diagnosticLogger = new Logger('RedirectAttributionDiagnostic');

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

    const resolvedIp = extractClientIp(req.headers, req.socket.remoteAddress);

    // TEMPORARY — see diagnosticLogger comment above.
    diagnosticLogger.log({
      xForwardedFor: req.headers['x-forwarded-for'] ?? null,
      xRealIp: req.headers['x-real-ip'] ?? null,
      socketRemoteAddress: req.socket.remoteAddress ?? null,
      resolvedIp: resolvedIp ?? null,
      referer: req.headers['referer'] ?? null,
      host: req.headers.host ?? null,
    });

    const outcome = await redirectService.resolve(shortCode, {
      ipAddress: resolvedIp,
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
      queryString: req.url.includes('?') ? req.url.split('?')[1] : undefined,
      host: req.headers.host,
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
