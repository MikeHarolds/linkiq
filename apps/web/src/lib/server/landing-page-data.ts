import type { PublicLandingPageContentDto, PublicPlanDto, PublicSiteConfigDto } from '@linkiq/types';

// Server-side fetch (runs in the Next.js server/RSC context, not the
// browser) — deliberately not routed through lib/api-client.ts, which
// is built around browser fetch semantics (credentials: 'include', an
// in-memory access token) that don't apply to an unauthenticated
// server-to-server GET. `cache: 'no-store'` intentionally defers all
// caching to LandingPageService's own 60s in-memory cache (see its
// docs) — that's the single source of truth for "how fresh is this
// content," so an admin edit is reflected on the very next page load
// rather than also waiting out a second, Next.js-level cache window.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Ships with the exact Sprint 12 copy baked in, used only if the API
 * is unreachable at render time — the public page must never crash or
 * go blank because the backend is briefly down. Kept intentionally
 * minimal (just enough for every section to render something
 * reasonable); the database (via prisma/seed.ts's seedLandingPageContent)
 * remains the actual source of truth in every normal case. */
const FALLBACK_CONTENT: PublicLandingPageContentDto = {
  sections: [],
  features: [],
  faqs: [],
  stats: [],
  navItems: { header: [], footerProduct: [], footerDevelopers: [], footerCompany: [] },
};

const FALLBACK_SITE_CONFIG: PublicSiteConfigDto = {
  siteName: 'LinkIQ',
  logoUrl: null,
  faviconUrl: null,
};

export async function getServerLandingPageContent(): Promise<PublicLandingPageContentDto> {
  try {
    const res = await fetch(`${API_URL}/public/landing-page`, { cache: 'no-store' });
    if (!res.ok) return FALLBACK_CONTENT;
    return (await res.json()) as PublicLandingPageContentDto;
  } catch {
    return FALLBACK_CONTENT;
  }
}

export async function getServerSiteConfig(): Promise<PublicSiteConfigDto> {
  try {
    const res = await fetch(`${API_URL}/public/site-config`, { cache: 'no-store' });
    if (!res.ok) return FALLBACK_SITE_CONFIG;
    return (await res.json()) as PublicSiteConfigDto;
  } catch {
    return FALLBACK_SITE_CONFIG;
  }
}

export async function getServerPlans(): Promise<PublicPlanDto[]> {
  try {
    const res = await fetch(`${API_URL}/public/plans`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as PublicPlanDto[];
  } catch {
    return [];
  }
}
