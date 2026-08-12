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
import {
  Check,
  ChevronsUpDown,
  LogOut,
  Menu,
  Settings,
  User as UserIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import * as React from 'react';

import { useAuth } from '@/providers/auth-provider';

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Links', href: '/dashboard/links' },
  { label: 'QR Codes', href: '/dashboard/qr-codes' },
  { label: 'Campaigns', href: '/dashboard/campaigns' },
  { label: 'Domains', href: '/dashboard/domains' },
  { label: 'Analytics', href: '/dashboard/analytics' },
  { label: 'Settings', href: '/dashboard/settings' },
] as const;

function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
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
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
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
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-col border-r bg-muted/20 md:flex">
        <div className="flex h-16 items-center px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            LinkIQ
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

        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-4 pt-0">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b px-4 md:justify-end md:px-6">
          {/* Mobile menu — everything the desktop sidebar offers, collapsed
              into one trigger so small screens keep full navigation access. */}
          <div className="flex items-center gap-2 md:hidden">
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
                    <Link href={item.href}>{item.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <WorkspaceSwitcher
              workspaces={workspaces}
              currentWorkspaceId={currentWorkspaceId}
              currentWorkspaceName={currentWorkspace?.name}
              onSwitch={switchWorkspace}
              className="max-w-[10rem]"
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
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
