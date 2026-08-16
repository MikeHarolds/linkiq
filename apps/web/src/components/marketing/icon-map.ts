import {
  Activity,
  BarChart3,
  Bell,
  CheckCircle2,
  Cloud,
  Code,
  Database,
  Globe2,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Mail,
  MousePointerClick,
  QrCode,
  Rocket,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Terminal,
  TrendingUp,
  Users,
  Webhook,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Maps a LandingPageIconKey (a plain string persisted in the
 * database) to the actual lucide-react component — the runtime half
 * of the "admin picks from a fixed list, never free text" design (see
 * @linkiq/types's LANDING_PAGE_ICON_KEYS, which this must stay in
 * sync with). Falls back to Sparkles for any key that somehow doesn't
 * match (e.g. the list was narrowed after content was already saved)
 * rather than rendering nothing. */
export const LANDING_PAGE_ICON_MAP: Record<string, LucideIcon> = {
  Link2,
  BarChart3,
  Globe2,
  Webhook,
  Users,
  Zap,
  ShieldCheck,
  Terminal,
  Lock,
  Shield,
  Rocket,
  Sparkles,
  Database,
  Code,
  Cloud,
  Smartphone,
  Mail,
  Bell,
  Search,
  Star,
  CheckCircle2,
  TrendingUp,
  Activity,
  MousePointerClick,
  QrCode,
  Settings,
  Layers,
  KeyRound,
};

export function resolveLandingPageIcon(key: string): LucideIcon {
  return LANDING_PAGE_ICON_MAP[key] ?? Sparkles;
}
