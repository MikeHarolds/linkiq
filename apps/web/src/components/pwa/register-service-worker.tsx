'use client';

import * as React from 'react';

/**
 * Registers /sw.js (root scope) once the page has loaded. Renders
 * nothing — this is a side-effect-only component, mounted once in the
 * root layout.
 *
 * Update flow: the browser checks for a new /sw.js on every navigation
 * automatically. Once a new worker installs and activates (it calls
 * skipWaiting()/clients.claim() itself — see public/sw.js), the
 * controller for this tab changes; we reload exactly once so the tab
 * picks up the new deployment's JS/CSS instead of continuing to run
 * against a stale app shell indefinitely. The `refreshing` guard stops
 * a reload loop if `controllerchange` fires more than once.
 */
export function RegisterServiceWorker() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!navigator.serviceWorker) return;
    // Service workers require a secure context — the browser itself
    // enforces this (HTTPS in production, localhost/127.0.0.1 in dev),
    // so no extra environment check is needed here.

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange,
    );

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration must never break the app — the page
        // keeps working exactly as it would with no service worker.
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      );
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
}
