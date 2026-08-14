'use client';

import { Avatar, AvatarFallback, Badge, Button, Separator } from '@linkiq/ui';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  Globe2,
  LayoutDashboard,
  Menu,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
  Webhook,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import * as React from 'react';

import { useAuth } from '@/providers/auth-provider';

const NAV_ITEMS = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Workspaces', href: '/admin/workspaces', icon: Globe2 },
  { label: 'Subscriptions', href: '/admin/subscriptions', icon: ArrowLeftRight },
  { label: 'Plans', href: '/admin/plans', icon: CreditCard },
  { label: 'Payments', href: '/admin/payments', icon: Wallet },
  { label: 'Invoices', href: '/admin/invoices', icon: ReceiptText },
  { label: 'API Usage', href: '/admin/api-usage', icon: BarChart3 },
  { label: 'Webhooks', href: '/admin/webhooks', icon: Webhook },
  { label: 'Domains', href: '/admin/domains', icon: Globe2 },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText },
  { label: 'Platform Settings', href: '/admin/settings', icon: Settings },
  { label: 'System Health', href: '/admin/system-health', icon: Activity },
] as const;

function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

/**
 * Dedicated Super Admin console shell — deliberately visually distinct
 * from (dashboard)/layout.tsx (dark sidebar, "Platform Admin" badge) so
 * this never reads as "the customer dashboard with extra links."
 *
 * The SUPER_ADMIN check below is UX ONLY — it redirects a signed-in
 * non-admin away from this area so they don't see a console full of
 * requests that will fail, but it is NOT the security boundary. Every
 * /admin/* API endpoint independently enforces SuperAdminGuard
 * server-side (see apps/api's common/guards/super-admin.guard.ts) —
 * hiding this navigation client-side never substitutes for that.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';

  React.useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!isSuperAdmin) {
      router.replace('/dashboard');
    }
  }, [isLoading, isAuthenticated, isSuperAdmin, router]);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  if (isLoading || !user || !isSuperAdmin) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center text-sm text-muted-foreground"
      >
        Loading…
      </div>
    );
  }

  const navList = (
    <nav aria-label="Admin" className="flex flex-1 flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileNavOpen(false)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar — dark theme, deliberately distinct from the
          customer dashboard's light bg-muted/20 sidebar. */}
      <aside className="hidden w-64 flex-col bg-slate-950 md:flex">
        <div className="flex h-16 items-center gap-2 px-5">
          <ShieldAlert className="h-5 w-5 text-amber-400" />
          <span className="text-lg font-semibold tracking-tight text-white">LinkIQ Admin</span>
        </div>
        <Separator className="bg-slate-800" />
        {navList}
        <div className="p-3">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="w-full border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </aside>

      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex w-64 flex-col bg-slate-950">
            <div className="flex h-16 items-center justify-between px-5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-400" />
                <span className="text-lg font-semibold text-white">LinkIQ Admin</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-300 hover:text-white"
                aria-label="Close navigation menu"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <Separator className="bg-slate-800" />
            {navList}
          </div>
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="flex-1 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b bg-background px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Badge variant="warning" className="hidden sm:inline-flex">
              Platform Administrator
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Avatar>
              <AvatarFallback>{initials(user.firstName, user.lastName)}</AvatarFallback>
            </Avatar>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
