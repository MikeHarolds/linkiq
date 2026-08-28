/**
 * Pure helpers for install-prompt detection/persistence — split out from
 * use-pwa-install.ts so they're testable without simulating
 * `beforeinstallprompt` (which jsdom/Testing Library can't dispatch as a
 * real browser event, since no browser actually fires it in a test
 * environment).
 */

const DISMISSED_UNTIL_KEY = 'linkiq-pwa-install-dismissed-until';
const INSTALLED_KEY = 'linkiq-pwa-installed';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** iOS/iPadOS Safari never fires beforeinstallprompt — this is the only
 * way to offer install guidance there. Excludes Chrome/Firefox-on-iOS
 * (still WebKit-only per Apple's rules, but they can't add to home
 * screen at all, so no instructions are useful) and excludes iPadOS 13+
 * "desktop" UA strings pretending to be Mac (caught via the
 * touch-support check in isIosSafari, not here). */
export function isIosUserAgent(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

/** iPadOS 13+ reports as "Macintosh" in the UA string but is
 * touch-capable, unlike a real Mac. maxTouchPoints is the standard
 * disambiguator recommended by WebKit itself for this exact case. */
export function isIpadOnDesktopUA(
  userAgent: string,
  maxTouchPoints: number,
): boolean {
  return /macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  return (
    isIosUserAgent(userAgent) || isIpadOnDesktopUA(userAgent, maxTouchPoints)
  );
}

/** Safari specifically (not Chrome/Firefox-on-iOS, which are WebKit
 * wrappers that report "CriOS"/"FxiOS" and cannot add to home screen at
 * all) — showing instructions in a browser that can't act on them would
 * just be confusing. */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  if (!isIosDevice(userAgent, maxTouchPoints)) return false;
  return !/crios|fxios|edgios|opios/i.test(userAgent);
}

export interface StandaloneCheckInputs {
  matchesStandaloneMediaQuery: boolean;
  navigatorStandalone?: boolean;
}

/** True when the app is already running installed — either the
 * standards-track `display-mode: standalone` media query (Chromium,
 * Android, desktop PWAs) or iOS Safari's proprietary
 * `navigator.standalone` (iOS has no display-mode support at all). */
export function isRunningStandalone({
  matchesStandaloneMediaQuery,
  navigatorStandalone,
}: StandaloneCheckInputs): boolean {
  return matchesStandaloneMediaQuery || navigatorStandalone === true;
}

export function readDismissedUntil(
  storage: Pick<Storage, 'getItem'>,
): number | null {
  const raw = storage.getItem(DISMISSED_UNTIL_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isDismissedNow(
  storage: Pick<Storage, 'getItem'>,
  now: number = Date.now(),
): boolean {
  const until = readDismissedUntil(storage);
  return until !== null && now < until;
}

/** Called on "Maybe later" — suppresses the prompt for a cooldown
 * period rather than forever, so a user who dismissed it once but later
 * decides they want LinkIQ installed isn't permanently locked out
 * without visiting a settings page that doesn't exist for this. */
export function dismissForCooldown(
  storage: Pick<Storage, 'setItem'>,
  now: number = Date.now(),
): void {
  storage.setItem(DISMISSED_UNTIL_KEY, String(now + DISMISS_COOLDOWN_MS));
}

export function markInstalled(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(INSTALLED_KEY, 'true');
}

export function wasEverInstalled(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(INSTALLED_KEY) === 'true';
}
