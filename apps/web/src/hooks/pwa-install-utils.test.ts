import { describe, expect, it } from 'vitest';

import {
  dismissForCooldown,
  isDismissedNow,
  isIosDevice,
  isIosSafari,
  isRunningStandalone,
  markInstalled,
  wasEverInstalled,
} from './pwa-install-utils';

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('iOS detection', () => {
  const IOS_SAFARI_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const IOS_CHROME_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';
  const ANDROID_CHROME_UA =
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  const DESKTOP_CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const MAC_SAFARI_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

  it('recognizes iPhone/iPad/iPod user agents', () => {
    expect(isIosDevice(IOS_SAFARI_UA)).toBe(true);
    expect(isIosDevice(ANDROID_CHROME_UA)).toBe(false);
    expect(isIosDevice(DESKTOP_CHROME_UA)).toBe(false);
  });

  it('recognizes iPadOS 13+ reporting as Macintosh via touch-point count', () => {
    expect(isIosDevice(MAC_SAFARI_UA, 5)).toBe(true);
    // A real Mac (mouse/trackpad, no touch) must not be misdetected.
    expect(isIosDevice(MAC_SAFARI_UA, 0)).toBe(false);
  });

  it('isIosSafari excludes Chrome/Firefox-on-iOS (WebKit wrappers that cannot add to home screen)', () => {
    expect(isIosSafari(IOS_SAFARI_UA)).toBe(true);
    expect(isIosSafari(IOS_CHROME_UA)).toBe(false);
  });

  it('isIosSafari is false for any non-iOS device', () => {
    expect(isIosSafari(DESKTOP_CHROME_UA)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME_UA)).toBe(false);
  });
});

describe('isRunningStandalone', () => {
  it('is true when the display-mode: standalone media query matches', () => {
    expect(isRunningStandalone({ matchesStandaloneMediaQuery: true })).toBe(
      true,
    );
  });

  it('is true when iOS navigator.standalone is true, even without the media query', () => {
    expect(
      isRunningStandalone({
        matchesStandaloneMediaQuery: false,
        navigatorStandalone: true,
      }),
    ).toBe(true);
  });

  it('is false in an ordinary browser tab', () => {
    expect(
      isRunningStandalone({
        matchesStandaloneMediaQuery: false,
        navigatorStandalone: false,
      }),
    ).toBe(false);
  });
});

describe('dismissal cooldown', () => {
  it('is not dismissed before "Maybe later" is ever clicked', () => {
    const storage = makeMemoryStorage();
    expect(isDismissedNow(storage)).toBe(false);
  });

  it('is dismissed immediately after dismissForCooldown, and stays dismissed within the window', () => {
    const storage = makeMemoryStorage();
    const now = Date.now();
    dismissForCooldown(storage, now);
    expect(isDismissedNow(storage, now)).toBe(true);
    expect(isDismissedNow(storage, now + 60_000)).toBe(true);
  });

  it('stops being dismissed once the cooldown window elapses', () => {
    const storage = makeMemoryStorage();
    const now = Date.now();
    dismissForCooldown(storage, now);
    const eightDaysLater = now + 8 * 24 * 60 * 60 * 1000;
    expect(isDismissedNow(storage, eightDaysLater)).toBe(false);
  });
});

describe('installed persistence', () => {
  it('wasEverInstalled is false until markInstalled is called', () => {
    const storage = makeMemoryStorage();
    expect(wasEverInstalled(storage)).toBe(false);
    markInstalled(storage);
    expect(wasEverInstalled(storage)).toBe(true);
  });
});
