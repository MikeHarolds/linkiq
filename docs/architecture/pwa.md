# Progressive Web App (Sprint 21)

LinkIQ's existing Next.js frontend is installable as a Progressive Web
App — no native wrapper (no Capacitor/React Native/Electron), no PWA
framework package. Everything here is Next.js's own `app/manifest.ts`
convention plus a small, hand-written service worker, because both were
fully sufficient for the requirements and a hand-written worker gives
exact, auditable control over what is (and — far more importantly —
is **not**) ever cached.

## 1. What's installable, and where

| Platform                                   | Install path                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome/Edge (desktop, Windows/macOS/Linux) | Address-bar install icon, or the in-app "Install LinkIQ" banner                                                                                                                                                                                   |
| Android (Chrome)                           | The in-app "Install LinkIQ" banner (fires from a real `beforeinstallprompt` event)                                                                                                                                                                |
| iOS / iPadOS (Safari)                      | Manual only — Safari never exposes `beforeinstallprompt`. The app shows static instructions: **Share → Add to Home Screen**. Chrome/Firefox-on-iOS are WebKit wrappers that cannot add to Home Screen at all, so no instructions are shown there. |
| Firefox (desktop)                          | No programmatic install prompt exists in this browser; the app simply shows nothing rather than a broken button.                                                                                                                                  |

The install banner never appears once the app is running installed
(`display-mode: standalone`, or iOS's `navigator.standalone`), and
"Maybe later" suppresses it for 7 days (`localStorage`-backed) rather
than forever or not at all — see
`src/hooks/use-pwa-install.ts`/`pwa-install-utils.ts`.

## 2. Manifest

`src/app/manifest.ts` (Next's native convention — no `next-pwa` or
similar package). Auto-served at `/manifest.webmanifest` and linked from
`<head>` automatically via the root layout's `metadata.manifest` field.

Brand values are taken from what already exists, not invented:
`theme_color: #F97316` matches `packages/ui/src/styles/globals.css`'s
`--primary`; the icons are raster (PNG) exports of `public/favicon.svg`
(the mark that already has an opaque background — the transparent
`logo.svg` was not used, since transparent icons render poorly on most
home-screen backgrounds). `public/icons/` contains `icon-192.png`,
`icon-512.png`, a `icon-maskable-512.png` (the mark scaled to 65% and
centered on white, so Android's adaptive-icon mask never crops it), and
`apple-touch-icon.png` (180×180, iOS's own convention, wired via
`metadata.icons.apple`).

## 3. Service worker — what is and isn't cached

`public/sw.js`, registered at root scope (`/`) by
`src/components/pwa/register-service-worker.tsx`.

**Never cached, by construction — not by a caching rule that has to
remember to exclude these, but because the fetch handler returns before
any cache code runs:**

- Every request under `/api/` (same-origin or cross-origin) — this
  covers the `/api/v1/auth/*` cookie-setting proxy _and_ every direct
  call to `NEXT_PUBLIC_API_URL` (dashboard, billing, invoices, admin,
  analytics, everything)
- Every non-`GET` request
- Every cross-origin request

**Cached (stale-while-revalidate):** Next's own content-hashed
`/_next/static/*` bundles, `/icons/*`, `/manifest.webmanifest`,
`/favicon.svg`, `/logo.svg`, `/offline.html` — static, non-personalized,
safe by nature.

**Cached (network-first, shell only):** `/` — a live network response
is always preferred; only on genuine offline failure does it fall back
to a cached shell or the offline page. No dashboard/admin/billing page
is ever added to the precache list, so there is no cached authenticated
page for this branch to ever serve stale.

The exact eligibility rule lives in `src/lib/pwa-cache-policy.ts`
(`isCacheEligible`), unit-tested directly. `public/sw.js` mirrors that
same rule (a classic, non-module service worker can't `import` it) — a
test in `pwa-cache-policy.test.ts` reads both files' source and fails if
they drift out of sync.

**Update flow:** the cache name is versioned; `activate` drops every
older version and calls `clients.claim()` immediately (`skipWaiting()`
on install too), so a new deploy's worker takes over without waiting for
every open tab to close. The client-side registration listens for
`controllerchange` and reloads the tab once, so a session left open
across a deploy picks up the new JS/CSS instead of running stale code
indefinitely.

## 4. Offline behavior

LinkIQ does not pretend to be an offline-capable application. Losing
connectivity shows a small top banner ("You appear to be offline.
Reconnect to continue.") via `navigator.onLine`/online/offline events —
it never implies cached billing/analytics/user data is still current,
because no such data is ever cached in the first place. A failed
navigation (e.g. opening the app fresh with no network) falls back to
`public/offline.html`, a static, branded, no-JS-required page with a
"Try again" button.

## 5. Security

- No secret of any kind is in the manifest (asserted by a unit test —
  the serialized manifest must never contain "key"/"secret"/"token"/
  "password")
- `sw.js` never touches an `Authorization` header, a cookie, or an
  auth/billing/admin response — the fetch handler exits before reaching
  any caching code for those (see §3)
- Service workers require a secure context; the browser itself enforces
  HTTPS in production and allows `localhost`/`127.0.0.1` in development
  — no application-level check was added or needed
- No new CSP was introduced (the web app had none before this sprint —
  only the API sets one, via Helmet, unrelated to this)

## 6. Environment compatibility

Zero new environment variables. `start_url`/`scope` are both `/`
(root-relative, no hardcoded host), and `public/sw.js`/`manifest.ts`
reference only relative/same-origin paths. `apps/web`'s `startCommand`
on Render is `next start` (not the `output: 'standalone'` server
bundle), which already serves `public/` directly from the source tree —
exactly how `favicon.svg`/`logo.svg` already worked before this sprint,
so `sw.js`/the icons/`offline.html` need no extra deployment step and
work identically on local Windows dev, GitHub Codespaces, and Render.

## 7. Limitations

- Programmatic install is Chromium-only; iOS/Safari is
  instructions-only by platform design (Apple provides no
  `beforeinstallprompt` equivalent)
- No true offline data access — this is a network-required product
  (link management, real-time analytics, billing), not an offline-first
  one, and the worker makes no attempt to fake otherwise
