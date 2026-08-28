'use client';

import * as React from 'react';

import {
  dismissForCooldown,
  isDismissedNow,
  isIosSafari,
  isRunningStandalone,
  markInstalled,
  wasEverInstalled,
} from './pwa-install-utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type PwaInstallStatus =
  'checking' | 'installable' | 'ios-instructions' | 'installed' | 'unavailable';

/** 'installable'/'ios-instructions' mean the same thing capability-wise
 * as PwaInstallStatus — this alias just documents that `capability` is
 * never gated by the "Maybe later" cooldown, unlike the public
 * `status` field. */
type Capability = PwaInstallStatus;

export interface UsePwaInstallResult {
  /** Drives the automatic banner (components/pwa/install-prompt.tsx) —
   * 'unavailable' while a "Maybe later" cooldown is active, even if the
   * device is actually capable of installing. */
  status: PwaInstallStatus;
  /** True whenever the device/browser is actually capable of installing
   * LinkIQ and it isn't already installed — deliberately ignores the
   * cooldown, so a manual entry point (e.g. an account-menu item) can
   * still offer installation during the days the automatic banner is
   * suppressed. */
  canInstall: boolean;
  /** Only meaningful when status === 'installable'. */
  promptInstall: () => Promise<void>;
  /** "Maybe later" — hides the automatic banner and starts the 7-day
   * cooldown. Does not affect canInstall. */
  dismiss: () => void;
  /** Single action for a manual entry point: on Chromium capability,
   * triggers the same native prompt as the banner's button; on iOS
   * capability, re-reveals the banner's Add-to-Home-Screen instructions
   * (bypassing the cooldown for this one manual reveal only — does not
   * touch or reset the persisted cooldown timestamp, so the automatic
   * banner's own suppression schedule is unaffected). No-op when
   * canInstall is false.
   */
  openInstall: () => void;
}

/**
 * Encapsulates the full install-capability state machine described in
 * Sprint 21 phases 4-6 (and extended for the manual account-menu entry
 * point added afterward):
 *  - 'installed': display-mode: standalone or iOS's navigator.standalone
 *    is true, or the appinstalled event fired earlier this browser —
 *    never show anything, anywhere.
 *  - 'ios-instructions': iOS Safari, not installed — beforeinstallprompt
 *    never fires here (Apple doesn't support it), so this is the only
 *    path to a fallback instruction banner.
 *  - 'installable': a real beforeinstallprompt event was captured
 *    (Chromium-based browsers on desktop/Android).
 *  - 'unavailable': anything else — unsupported browser, or a Chromium
 *    browser that hasn't fired the event yet.
 *
 * Capability detection (iOS UA check, beforeinstallprompt/appinstalled
 * listeners) always runs whenever the app isn't already installed —
 * independent of whether a "Maybe later" cooldown is currently
 * suppressing the automatic banner. That's what lets canInstall/
 * openInstall keep working during the cooldown window: the underlying
 * event is still captured, there's just no unsolicited banner nagging
 * about it.
 */
export function usePwaInstall(): UsePwaInstallResult {
  const [capability, setCapability] = React.useState<Capability>('checking');
  const [autoPromptSuppressed, setAutoPromptSuppressed] = React.useState(false);
  const deferredPromptRef = React.useRef<BeforeInstallPromptEvent | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone = isRunningStandalone({
      matchesStandaloneMediaQuery: window.matchMedia(
        '(display-mode: standalone)',
      ).matches,
      navigatorStandalone: (
        window.navigator as Navigator & { standalone?: boolean }
      ).standalone,
    });

    if (standalone || wasEverInstalled(window.localStorage)) {
      setCapability('installed');
      return;
    }

    setAutoPromptSuppressed(isDismissedNow(window.localStorage));

    if (
      isIosSafari(window.navigator.userAgent, window.navigator.maxTouchPoints)
    ) {
      setCapability('ios-instructions');
      return;
    }

    setCapability('unavailable');

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setCapability('installable');
    };
    const onAppInstalled = () => {
      markInstalled(window.localStorage);
      deferredPromptRef.current = null;
      setCapability('installed');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = React.useCallback(async () => {
    const event = deferredPromptRef.current;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A captured event can only ever be prompted once, regardless of
    // outcome — Chromium never lets it be reused.
    deferredPromptRef.current = null;
    if (outcome === 'accepted') {
      // appinstalled will also fire and set this same value — setting
      // it here too avoids a UI flash showing the prompt again in the
      // gap before that event arrives.
      markInstalled(window.localStorage);
      setCapability('installed');
    } else {
      setCapability('unavailable');
    }
  }, []);

  const dismiss = React.useCallback(() => {
    dismissForCooldown(window.localStorage);
    setAutoPromptSuppressed(true);
  }, []);

  const openInstall = React.useCallback(() => {
    if (capability === 'installable') {
      void promptInstall();
      return;
    }
    if (capability === 'ios-instructions') {
      // Local-only: reveals the same banner the cooldown is currently
      // hiding, without touching the persisted cooldown timestamp — the
      // automatic banner's own suppression schedule is unchanged.
      setAutoPromptSuppressed(false);
    }
  }, [capability, promptInstall]);

  const status: PwaInstallStatus =
    (capability === 'installable' || capability === 'ios-instructions') &&
    autoPromptSuppressed
      ? 'unavailable'
      : capability;

  const canInstall =
    capability === 'installable' || capability === 'ios-instructions';

  return { status, canInstall, promptInstall, dismiss, openInstall };
}
