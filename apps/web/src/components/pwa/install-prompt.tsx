'use client';

import { Button } from '@linkiq/ui';
import { X } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

import { usePwaInstall } from '@/hooks/use-pwa-install';

/**
 * Unobtrusive install banner — bottom-anchored, full-width on small
 * screens and a compact card on larger ones, never covering primary
 * content (fixed positioning outside the document flow, generous
 * z-index but well below dialogs/toasts). Renders nothing for
 * 'checking'/'installed'/'unavailable' — see use-pwa-install.ts for
 * exactly when each status applies.
 */
export function InstallPrompt() {
  const { status, promptInstall, dismiss } = usePwaInstall();
  const [installing, setInstalling] = React.useState(false);

  if (status !== 'installable' && status !== 'ios-instructions') return null;

  async function handleInstall() {
    setInstalling(true);
    try {
      await promptInstall();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Install LinkIQ"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 sm:bottom-4 sm:left-auto sm:right-4 sm:p-0"
    >
      <div className="flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold">Install LinkIQ</p>
            {status === 'installable' ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Install LinkIQ for faster access to your links, analytics and
                campaigns.
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                To install LinkIQ: tap{' '}
                <span className="font-medium text-foreground">Share</span> then{' '}
                <span className="font-medium text-foreground">
                  Add to Home Screen
                </span>
                .
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {status === 'installable' && (
              <Button
                type="button"
                size="sm"
                disabled={installing}
                onClick={handleInstall}
              >
                {installing ? 'Installing…' : 'Install LinkIQ'}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={dismiss}>
              Maybe later
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
