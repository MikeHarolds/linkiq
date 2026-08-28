import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePwaInstall } from './use-pwa-install';

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function makeBeforeInstallPromptEvent(
  outcome: 'accepted' | 'dismissed' = 'accepted',
) {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('usePwaInstall', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockMatchMedia(false);
    setUserAgent(ANDROID_CHROME_UA);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports "installed" when already running in standalone display-mode — no prompt, no instructions', async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePwaInstall());
    await waitFor(() => expect(result.current.status).toBe('installed'));
  });

  it('reports "installed" when appinstalled fired in a previous session (persisted flag)', async () => {
    window.localStorage.setItem('linkiq-pwa-installed', 'true');
    const { result } = renderHook(() => usePwaInstall());
    await waitFor(() => expect(result.current.status).toBe('installed'));
  });

  it('reports "ios-instructions" on iOS Safari, not installed, not dismissed', async () => {
    setUserAgent(IOS_SAFARI_UA);
    const { result } = renderHook(() => usePwaInstall());
    await waitFor(() => expect(result.current.status).toBe('ios-instructions'));
  });

  it('reports "unavailable" on an unsupported/undetermined browser until a real event fires', async () => {
    const { result } = renderHook(() => usePwaInstall());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  it('reports "installable" once a real beforeinstallprompt event is captured, and "installed" after acceptance', async () => {
    const { result } = renderHook(() => usePwaInstall());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));

    const preventDefault = vi.fn();
    const promptEvent = new Event('beforeinstallprompt') as Event & {
      preventDefault: typeof preventDefault;
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    };
    promptEvent.preventDefault = preventDefault;
    promptEvent.prompt = vi.fn().mockResolvedValue(undefined);
    promptEvent.userChoice = Promise.resolve({ outcome: 'accepted' });

    act(() => {
      window.dispatchEvent(promptEvent);
    });

    expect(preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe('installable'));

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(promptEvent.prompt).toHaveBeenCalled();
    expect(result.current.status).toBe('installed');
    expect(window.localStorage.getItem('linkiq-pwa-installed')).toBe('true');
  });

  it('dismiss() suppresses the prompt via the cooldown store', async () => {
    const { result } = renderHook(() => usePwaInstall());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));

    act(() => {
      result.current.dismiss();
    });

    expect(
      window.localStorage.getItem('linkiq-pwa-install-dismissed-until'),
    ).not.toBeNull();
  });

  it('never shows any prompt state when dismissed within the cooldown window, even on iOS', async () => {
    setUserAgent(IOS_SAFARI_UA);
    window.localStorage.setItem(
      'linkiq-pwa-install-dismissed-until',
      String(Date.now() + 60_000),
    );
    const { result } = renderHook(() => usePwaInstall());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  describe('canInstall / openInstall — the manual account-menu entry point', () => {
    it('canInstall is false before any capability is known, and false on an unsupported browser', async () => {
      const { result } = renderHook(() => usePwaInstall());
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.canInstall).toBe(false);
    });

    it('canInstall is false once already installed', async () => {
      mockMatchMedia(true);
      const { result } = renderHook(() => usePwaInstall());
      await waitFor(() => expect(result.current.status).toBe('installed'));
      expect(result.current.canInstall).toBe(false);
    });

    it('canInstall stays true on iOS even during an active "Maybe later" cooldown', async () => {
      setUserAgent(IOS_SAFARI_UA);
      window.localStorage.setItem(
        'linkiq-pwa-install-dismissed-until',
        String(Date.now() + 60_000),
      );
      const { result } = renderHook(() => usePwaInstall());
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.canInstall).toBe(true);
    });

    it('canInstall stays true for a captured beforeinstallprompt event even during an active cooldown', async () => {
      window.localStorage.setItem(
        'linkiq-pwa-install-dismissed-until',
        String(Date.now() + 60_000),
      );
      const { result } = renderHook(() => usePwaInstall());
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.canInstall).toBe(false); // no event captured yet

      act(() => {
        window.dispatchEvent(makeBeforeInstallPromptEvent());
      });

      await waitFor(() => expect(result.current.canInstall).toBe(true));
      // The automatic banner stays hidden — only canInstall reflects capability.
      expect(result.current.status).toBe('unavailable');
    });

    it('openInstall() triggers the native prompt directly for Chromium capability', async () => {
      const { result } = renderHook(() => usePwaInstall());
      const promptEvent = makeBeforeInstallPromptEvent('accepted');
      act(() => {
        window.dispatchEvent(promptEvent);
      });
      await waitFor(() => expect(result.current.canInstall).toBe(true));

      act(() => {
        result.current.openInstall();
      });

      await waitFor(() => expect(promptEvent.prompt).toHaveBeenCalled());
      await waitFor(() => expect(result.current.status).toBe('installed'));
    });

    it('openInstall() re-reveals the iOS instructions banner without resetting the persisted cooldown', async () => {
      setUserAgent(IOS_SAFARI_UA);
      const originalDismissedAt = Date.now() + 60_000;
      window.localStorage.setItem(
        'linkiq-pwa-install-dismissed-until',
        String(originalDismissedAt),
      );
      const { result } = renderHook(() => usePwaInstall());
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(result.current.canInstall).toBe(true);

      act(() => {
        result.current.openInstall();
      });

      await waitFor(() =>
        expect(result.current.status).toBe('ios-instructions'),
      );
      // The 7-day cooldown timestamp itself is untouched by a manual reveal.
      expect(
        window.localStorage.getItem('linkiq-pwa-install-dismissed-until'),
      ).toBe(String(originalDismissedAt));
    });

    it('openInstall() is a no-op when canInstall is false', async () => {
      const { result } = renderHook(() => usePwaInstall());
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
      expect(() => result.current.openInstall()).not.toThrow();
      expect(result.current.status).toBe('unavailable');
    });
  });
});
