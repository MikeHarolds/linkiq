'use client';

import * as React from 'react';

/**
 * Non-blocking connectivity banner (Sprint 21 phase 8). Deliberately
 * does not attempt to keep the app usable offline — its only job is to
 * make the offline state visible so a user never mistakes a stale
 * screen (billing, analytics, dashboard data already rendered before
 * connectivity dropped) for current data. `navigator.onLine` plus the
 * online/offline window events is the standard, widely-supported
 * mechanism; no service-worker involvement needed since this only
 * concerns UI, not caching.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOffline(!window.navigator.onLine);

    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      You appear to be offline. Reconnect to continue.
    </div>
  );
}
