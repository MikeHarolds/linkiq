import { ThemeProvider } from '@linkiq/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '../styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LinkIQ Docs',
    template: '%s · LinkIQ Docs',
  },
  description: 'Architecture, setup, and API documentation for LinkIQ.',
};

export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background min-h-screen font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
