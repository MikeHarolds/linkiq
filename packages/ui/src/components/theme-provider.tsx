'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import * as React from 'react';

export type ThemeProviderProps = React.ComponentProps<
  typeof NextThemesProvider
>;

/**
 * Wraps next-themes so dark mode works via the `class` strategy that
 * our Tailwind config (packages/config/tailwind/base.js) expects.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
