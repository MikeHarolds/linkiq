import { ThemeProvider, Toaster } from '@linkiq/ui';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { InstallPrompt } from '@/components/pwa/install-prompt';
import { OfflineBanner } from '@/components/pwa/offline-banner';
import { RegisterServiceWorker } from '@/components/pwa/register-service-worker';
import { AuthProvider } from '@/providers/auth-provider';
import { CurrencyProvider } from '@/providers/currency-provider';
import { QueryProvider } from '@/providers/query-provider';

import '../styles/globals.css';

// Self-hosted via next/font (no external font CDN, no layout-shift
// flash) — exposed as the --font-sans CSS variable that
// packages/config/tailwind/base.js's fontFamily.sans maps to, so every
// existing `font-sans` usage across the app picks it up automatically.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://linkiq.io';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'LinkIQ — Turn every link into a growth engine',
    template: '%s · LinkIQ',
  },
  description:
    'Shorten, brand, track, and optimize every link from one platform built for modern teams — custom domains, real-time analytics, and a developer-ready API.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'LinkIQ',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    siteName: 'LinkIQ',
    title: 'LinkIQ — Turn every link into a growth engine',
    description:
      'Shorten, brand, track, and optimize every link from one platform built for modern teams.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LinkIQ — Turn every link into a growth engine',
    description:
      'Shorten, brand, track, and optimize every link from one platform built for modern teams.',
  },
};

// themeColor/colorScheme live in a separate `viewport` export (not
// `metadata`) as of Next.js 14+ — matches manifest.ts's theme_color
// (#F97316, packages/ui/src/styles/globals.css's --primary) so the
// browser UI (address bar on Android, title bar on installed desktop
// PWAs) and the manifest agree.
export const viewport: Viewport = {
  themeColor: '#F97316',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <CurrencyProvider>
                {children}
                <Toaster position="top-right" />
                <RegisterServiceWorker />
                <OfflineBanner />
                <InstallPrompt />
              </CurrencyProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
