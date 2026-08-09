import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/**
 * Centralizes refresh-cookie set/clear so every call site (login, register,
 * refresh, logout) uses identical flags. httpOnly + sameSite=lax means the
 * cookie is inaccessible to JavaScript (immune to XSS token theft) and not
 * sent on cross-site navigations, while still working for same-site fetches
 * from the web app.
 */
export function setRefreshCookie(
  res: Response,
  config: ConfigService,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(config.get<string>('auth.cookie.name')!, token, {
    httpOnly: true,
    secure: config.get<boolean>('auth.cookie.secure'),
    sameSite: 'lax',
    domain: config.get<string>('auth.cookie.domain'),
    path: '/',
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response, config: ConfigService): void {
  res.clearCookie(config.get<string>('auth.cookie.name')!, {
    httpOnly: true,
    secure: config.get<boolean>('auth.cookie.secure'),
    sameSite: 'lax',
    domain: config.get<string>('auth.cookie.domain'),
    path: '/',
  });
}
