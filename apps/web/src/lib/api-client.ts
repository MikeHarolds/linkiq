import type { ApiErrorResponse } from '@linkiq/types';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * Same-origin path prefix for the cookie-setting auth endpoints
 * (login/register/refresh/logout), proxied to the API by next.config.js's
 * rewrite. These calls cannot use API_URL directly: on Render (and any
 * split-hostname deployment, e.g. Codespaces' forwarded ports), the web
 * and API apps are on different hosts, so a cookie the API sets via
 * Set-Cookie is scoped to the API's own host only (RFC 6265 - no Domain
 * attribute means host-only) and browsers never send it back on
 * requests to the web app's origin. That breaks two things at once:
 * middleware.ts's cookie-presence check (always sees no cookie, so
 * /dashboard and /admin redirect to /login immediately after a
 * successful login) and this module's own silent-refresh-on-mount
 * (the browser won't attach a cookie scoped to a different host to a
 * cross-origin fetch either). Routing these specific calls through the
 * web app's own origin makes the browser see them as same-origin, so
 * the cookie is stored against linkiq-web's own host and both of the
 * above start seeing it correctly. Every other API call is unaffected
 * — they authenticate via the in-memory Bearer accessToken, not this
 * cookie, and keep going straight to API_URL as before.
 */
const SAME_ORIGIN_API_PREFIX = '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: ApiErrorResponse,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * In-memory access token. Deliberately NOT persisted to localStorage or
 * sessionStorage — an XSS payload that can execute JS on this origin could
 * read either of those, but it can't read a variable that only exists in
 * this module's closure across a fresh page load. Session continuity
 * across reloads comes from the httpOnly refresh cookie instead (see
 * AuthProvider's silent-refresh-on-mount).
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the automatic 401 -> refresh -> retry-once flow (used BY the refresh call itself, to avoid recursion). */
  skipAuthRetry?: boolean;
  /** Route through the web app's own origin (see SAME_ORIGIN_API_PREFIX) instead of API_URL — only for calls that set/rely on the httpOnly refresh cookie. */
  sameOrigin?: boolean;
}

let refreshPromise: Promise<boolean> | null = null;

/**
 * Attempts to exchange the httpOnly refresh cookie for a new access token.
 * Coalesces concurrent callers into a single in-flight request so a burst
 * of parallel 401s doesn't trigger a refresh stampede.
 */
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${SAME_ORIGIN_API_PREFIX}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          setAccessToken(null);
          return false;
        }
        const data = (await res.json()) as { accessToken: string };
        setAccessToken(data.accessToken);
        return true;
      })
      .catch(() => {
        setAccessToken(null);
        return false;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorResponse;
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message;
    return new ApiError(message, res.status, body);
  } catch {
    return new ApiError(res.statusText || 'Request failed', res.status);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, skipAuthRetry, sameOrigin, headers, ...rest } = options;

  // FormData (file uploads) must never be JSON-stringified, and must
  // never get an explicit Content-Type — the browser sets its own,
  // including the multipart boundary, only when Content-Type is left
  // unset. Every other request keeps the existing JSON behavior.
  const isFormData =
    typeof FormData !== 'undefined' && body instanceof FormData;

  const base = sameOrigin ? SAME_ORIGIN_API_PREFIX : API_URL;

  const doFetch = () =>
    fetch(`${base}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: isFormData
        ? (body as FormData)
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
    });

  let res = await doFetch();

  if (res.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
