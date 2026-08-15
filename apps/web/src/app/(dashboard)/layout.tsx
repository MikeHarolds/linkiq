'use client';

import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
} from '@linkiq/ui';
import { cn } from '@linkiq/utils';
import {
  BarChart3,
  Check,
  ChevronsUpDown,
  CreditCard,
  Globe2,
  LayoutDashboard,
  type LucideIcon,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  QrCode,
  Search,
  Settings,
  Terminal,
  User as UserIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import * as React from 'react';

import { BrandMark } from '@/components/shared/brand-mark';
import { useAuth } from '@/providers/auth-provider';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Links', href: '/dashboard/links', icon: Link2 },
      { label: 'QR Codes', href: '/dashboard/qr-codes', icon: QrCode },
      { label: 'Campaigns', href: '/dashboard/campaigns', icon: Megaphone },
      { label: 'Domains', href: '/dashboard/domains', icon: Globe2 },
      { label: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Billing', href: '/dashboard/billing', icon: CreditCard },
      { label: 'Developers', href: '/dashboard/developers', icon: Terminal },
      { label: 'Settings', href: '/dashboard/settings', icon: Settings },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

function isActive(pathname: string, href: string): boolean {
  return href === '/dashboard'
    ? pathname === '/dashboard'
    : pathname.startsWith(href);
}

/** The current section's label, derived from the route the way a
 * breadcrumb would be — not a fake per-entity breadcrumb (a link's own
 * title, a campaign's name, etc.), since the layout has no access to
 * that leaf-page data without a larger architectural change. */
function currentSectionLabel(pathname: string): string {
  const match = NAV_ITEMS.find((item) => isActive(pathname, item.href));
  return match?.label ?? 'Dashboard';
}

interface WorkspaceSwitcherProps {
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string | null;
  currentWorkspaceName: string | undefined;
  onSwitch: (id: string) => void;
  className?: string;
}

function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  currentWorkspaceName,
  onSwitch,
  className,
}: WorkspaceSwitcherProps) {
  if (workspaces.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`justify-between font-normal ${className ?? ''}`}
        >
          <span className="truncate">
            {currentWorkspaceName ?? 'Select workspace'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => onSwitch(workspace.id)}
            className="justify-between"
          >
            <span className="truncate">{workspace.name}</span>
            {workspace.id === currentWorkspaceId && (
              <Check className="h-4 w-4 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Header search — genuinely functional, not decorative: it reuses the
 * exact same search capability the Links page's own search box already
 * has (listLinks' `search` query param), just exposed from anywhere in
 * the dashboard. Submitting navigates to /dashboard/links?q=..., and
 * the Links page reads that param to pre-fill its own search field.
 * There's no global cross-entity search endpoint in the API, so this
 * deliberately doesn't pretend to search campaigns/domains/etc. too. */
function HeaderSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = React.useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    router.push(
      trimmed
        ? `/dashboard/links?q=${encodeURIComponent(trimmed)}`
        : '/dashboard/links',
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search links…"
        aria-label="Search links"
        className="h-9 w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </form>
  );
}

/**
 * Shell for authenticated app routes: fixed sidebar (desktop) + top bar.
 * Client-side enforces the "must be authenticated" boundary (redirects to
 * /login once the initial silent-refresh resolves and there's no user) —
 * this is a UX convenience layered on top of the real enforcement, which
 * is every protected API endpoint rejecting unauthenticated requests
 * server-side.
 *
 * Below the `md` breakpoint the sidebar is replaced by a menu button in
 * the top bar (same nav items + workspace switcher, in a dropdown) — the
 * desktop sidebar is simply hidden on small screens, not duplicated.
 *
 * The `dashboard-shell` class scopes the deeper fintech-style dark
 * palette defined in globals.css to exactly this subtree — it has no
 * effect in light mode, and no effect at all outside this layout, so
 * (admin) and the marketing site are untouched by it.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    user,
    workspaces,
    currentWorkspaceId,
    switchWorkspace,
    logout,
    isLoading,
    isAuthenticated,
  } = useAuth();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  if (isLoading || !user) {
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

  return (
    <div className="dashboard-shell flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r bg-muted/20 md:flex">
        <div className="flex h-16 items-center gap-2 px-6">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark size={24} />
            <span className="text-lg font-semibold tracking-tight">LinkIQ</span>
          </Link>
        </div>
        <Separator />

        <div className="p-3">
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
            currentWorkspaceName={currentWorkspace?.name}
            onSwitch={switchWorkspace}
            className="w-full"
          />
        </div>

        <nav
          aria-label="Main"
          className="flex flex-1 flex-col gap-5 overflow-y-auto p-3 pt-1"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-dash-elevated text-foreground'
                        : 'text-muted-foreground hover:bg-dash-elevated/60 hover:text-foreground',
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.65)]"
                      />
                    )}
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
                        active
                          ? 'bg-primary/15 text-primary'
                          : 'text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* min-w-0 overrides the flex-item default of min-width:auto — without
          it, this column refuses to shrink below the natural (unwrapped)
          width of whatever text content lives inside it on narrow
          viewports, overflowing its own parent instead of wrapping/
          truncating as each child's own overflow-x-auto/truncate classes
          already expect it to be able to. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {/* Mobile menu — everything the desktop sidebar offers, collapsed
                into one trigger so small screens keep full navigation access. */}
            <div className="md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Navigate</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {NAV_ITEMS.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href}>
                        <item.icon
                          className="mr-2 h-4 w-4"
                          aria-hidden="true"
                        />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <h2 className="truncate text-sm font-semibold text-foreground md:text-base">
              {currentSectionLabel(pathname)}
            </h2>
          </div>

          <HeaderSearch className="hidden max-w-xs flex-1 sm:block" />

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden md:block">
              <WorkspaceSwitcher
                workspaces={workspaces}
                currentWorkspaceId={currentWorkspaceId}
                currentWorkspaceName={currentWorkspace?.name}
                onSwitch={switchWorkspace}
                className="max-w-[12rem]"
              />
            </div>
            <div className="md:hidden">
              <WorkspaceSwitcher
                workspaces={workspaces}
                currentWorkspaceId={currentWorkspaceId}
                currentWorkspaceName={currentWorkspace?.name}
                onSwitch={switchWorkspace}
                className="max-w-[8rem]"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-9 w-9 rounded-full p-0"
                  aria-label="Open account menu"
                >
                  <Avatar>
                    <AvatarFallback>
                      {initials(user.firstName, user.lastName)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings" className="cursor-pointer">
                    <UserIcon className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
