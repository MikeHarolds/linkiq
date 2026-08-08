import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Layout for authentication routes (login, register, password reset).
 * Centers a single card on a minimal, distraction-free background —
 * intentionally excludes the marketing nav/footer and dashboard shell.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-muted/30 px-4 py-12">
      <Link href="/" className="text-xl font-semibold tracking-tight">
        LinkIQ
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
