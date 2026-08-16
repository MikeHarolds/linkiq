import { ThemeProvider, Toaster } from '@linkiq/ui';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

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
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
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
              </CurrencyProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
