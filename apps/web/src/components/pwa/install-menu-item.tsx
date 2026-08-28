'use client';

import { DropdownMenuItem } from '@linkiq/ui';
import { Download } from 'lucide-react';

import { usePwaInstall } from '@/hooks/use-pwa-install';

/**
 * Manual "revisit installation" entry point for the account menu.
 * `canInstall` deliberately ignores the 7-day "Maybe later" cooldown
 * (see use-pwa-install.ts) — that cooldown only suppresses the
 * *unsolicited* banner; a user who wants to find the option again
 * during those 7 days should still be able to. `openInstall()` reuses
 * the exact same capability/action the automatic banner already uses:
 * a captured beforeinstallprompt event on Chromium, or a reveal of the
 * same Add-to-Home-Screen instructions on iOS Safari — no separate
 * install logic lives here.
 */
export function InstallMenuItem() {
  const { canInstall, openInstall } = usePwaInstall();

  if (!canInstall) return null;

  return (
    <DropdownMenuItem onClick={openInstall} className="cursor-pointer">
      <Download className="mr-2 h-4 w-4" />
      Install LinkIQ
    </DropdownMenuItem>
  );
}
