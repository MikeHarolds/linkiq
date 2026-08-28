import type { MetadataRoute } from 'next';

/**
 * Next.js's native manifest file convention (stable since Next 13, no
 * plugin needed) — auto-served at /manifest.webmanifest and linked from
 * <head> automatically. Uses the same brand mark/color already defined
 * in packages/ui/src/styles/globals.css (--primary: 25 95% 53% = #F97316)
 * and public/favicon.svg (white rounded-square background) — the icons
 * below are raster exports of that exact mark, not a new logo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LinkIQ',
    short_name: 'LinkIQ',
    description: 'Turn every link into a growth engine.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#FFFFFF',
    theme_color: '#F97316',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
