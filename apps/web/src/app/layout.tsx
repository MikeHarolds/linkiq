import { ThemeProvider, Toaster } from '@linkiq/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { QueryProvider } from '@/providers/query-provider';

import '../styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LinkIQ — Intelligent Link Management',
    template: '%s · LinkIQ',
  },
  description:
    'Smart URL shortening, real-time analytics, and AI-powered insights for modern teams.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider>
          <QueryProvider>
            {children}
            <Toaster position="top-right" />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
