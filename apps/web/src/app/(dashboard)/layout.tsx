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
import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Links', href: '/dashboard/links' },
  { label: 'Campaigns', href: '/dashboard/campaigns' },
  { label: 'Analytics', href: '/dashboard/analytics' },
  { label: 'Settings', href: '/dashboard/settings' },
] as const;

/**
 * Shell for authenticated app routes: fixed sidebar + top bar.
 * Navigation items are placeholders; the routes they point to are
 * implemented in their respective feature milestones.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 flex-col border-r bg-muted/20 md:flex">
        <div className="flex h-16 items-center px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            LinkIQ
          </Link>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-end gap-4 border-b px-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-9 w-9 rounded-full p-0"
              >
                <Avatar>
                  <AvatarFallback>DU</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Profile</DropdownMenuItem>
              <DropdownMenuItem disabled>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
