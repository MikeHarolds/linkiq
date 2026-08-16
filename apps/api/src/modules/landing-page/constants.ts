/**
 * Curated, deliberately finite set of lucide-react icon names an admin
 * may attach to a feature/stat — never free-text, so this field can
 * never be used to inject arbitrary markup into the public page. Keep
 * this in sync with packages/types/src/index.ts's own
 * LANDING_PAGE_ICON_KEYS (same values, independently declared — the
 * same cross-boundary pattern already used for PlanLimitKey, a Prisma
 * enum here vs. a plain union type on the frontend).
 */
export const LANDING_PAGE_ICON_KEYS = [
  'Link2',
  'BarChart3',
  'Globe2',
  'Webhook',
  'Users',
  'Zap',
  'ShieldCheck',
  'Terminal',
  'Lock',
  'Shield',
  'Rocket',
  'Sparkles',
  'Database',
  'Code',
  'Cloud',
  'Smartphone',
  'Mail',
  'Bell',
  'Search',
  'Star',
  'CheckCircle2',
  'TrendingUp',
  'Activity',
  'MousePointerClick',
  'QrCode',
  'Settings',
  'Layers',
  'KeyRound',
] as const;

export type LandingPageIconKey = (typeof LANDING_PAGE_ICON_KEYS)[number];
