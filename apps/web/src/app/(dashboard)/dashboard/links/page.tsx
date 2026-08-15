'use client';

import type { LinkDto, LinkStatus } from '@linkiq/types';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import {
  activateLink,
  archiveLink,
  deleteLink,
  listLinks,
  pauseLink,
} from '@/lib/links-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

import { CreateLinkDialog } from './create-link-dialog';
import { EditLinkDialog } from './edit-link-dialog';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: LinkStatus | 'ALL' }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Paused', value: 'PAUSED' },
  { label: 'Archived', value: 'ARCHIVED' },
];

function isExpired(link: LinkDto): boolean {
  return (
    link.status === 'ACTIVE' &&
    link.expiresAt !== null &&
    new Date(link.expiresAt).getTime() < Date.now()
  );
}

function StatusBadge({ link }: { link: LinkDto }) {
  if (isExpired(link)) {
    return <Badge variant="warning">Expired</Badge>;
  }
  switch (link.status) {
    case 'ACTIVE':
      return <Badge variant="success">Active</Badge>;
    case 'PAUSED':
      return <Badge variant="secondary">Paused</Badge>;
    case 'ARCHIVED':
      return <Badge variant="outline">Archived</Badge>;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function LinksPage() {
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  const canManage =
    currentRole === 'OWNER' ||
    currentRole === 'ADMIN' ||
    currentRole === 'MEMBER';

  // Pre-fills from ?q= when arriving via the dashboard header's search
  // box (see (dashboard)/layout.tsx's HeaderSearch) — read once on
  // mount, not kept in sync afterward, so typing here doesn't fight
  // with the URL.
  const initialQuery = searchParams.get('q') ?? '';
  const [search, setSearch] = React.useState(initialQuery);
  const [debouncedSearch, setDebouncedSearch] = React.useState(initialQuery);
  const [status, setStatus] = React.useState<LinkStatus | 'ALL'>('ALL');
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingLink, setEditingLink] = React.useState<LinkDto | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const queryKey = ['links', currentWorkspaceId, page, debouncedSearch, status];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      listLinks(currentWorkspaceId!, {
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        status: status === 'ALL' ? undefined : status,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['links', currentWorkspaceId] });
  }

  async function handleCopy(link: LinkDto) {
    await navigator.clipboard.writeText(
      link.publicUrl ?? `${APP_URL}/${link.shortCode}`,
    );
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handlePause(link: LinkDto) {
    try {
      await pauseLink(currentWorkspaceId!, link.id);
      toast.success('Link paused');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to pause link',
      );
    }
  }

  async function handleActivate(link: LinkDto) {
    try {
      await activateLink(currentWorkspaceId!, link.id);
      toast.success('Link activated');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to activate link',
      );
    }
  }

  async function handleArchive(link: LinkDto) {
    try {
      await archiveLink(currentWorkspaceId!, link.id);
      toast.success('Link archived');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to archive link',
      );
    }
  }

  async function handleDelete(link: LinkDto) {
    if (
      !window.confirm(
        `Delete "${link.title ?? link.shortCode}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await deleteLink(currentWorkspaceId!, link.id);
      toast.success('Link deleted');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete link',
      );
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">Select a workspace to view links.</p>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Links"
        description="Create and manage your short links."
        actions={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create link
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by title, short code, or destination…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
          aria-label="Search links"
        />
        <div className="flex gap-1">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={status === filter.value ? 'default' : 'outline'}
              onClick={() => {
                setStatus(filter.value);
                setPage(1);
              }}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-muted-foreground"
        >
          Loading links…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load links.'}
        </div>
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <Link2
            className="mx-auto h-8 w-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="mt-3 text-muted-foreground">
            {debouncedSearch || status !== 'ALL'
              ? 'No links match your filters.'
              : "You haven't created any links yet."}
          </p>
          {canManage && !debouncedSearch && status === 'ALL' && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first link
            </Button>
          )}
        </div>
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Short link</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((link) => (
                  <TableRow key={link.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/dashboard/links/${link.id}`}
                          className="min-w-0 truncate font-mono text-sm font-semibold text-primary transition-colors hover:text-dash-highlight hover:underline"
                        >
                          {link.publicUrl
                            ? link.publicUrl.replace(/^https?:\/\//, '')
                            : `${APP_URL.replace(/^https?:\/\//, '')}/${link.shortCode}`}
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => handleCopy(link)}
                          aria-label="Copy short URL"
                        >
                          {copiedId === link.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {link.title ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <a
                        href={link.destinationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 truncate text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <span className="truncate">{link.destinationUrl}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <StatusBadge link={link} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(link.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(link.expiresAt)}
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Link actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/dashboard/links/${link.id}/analytics`}
                              >
                                <BarChart3 className="mr-2 h-4 w-4" />
                                Analytics
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setEditingLink(link)}
                            >
                              Edit
                            </DropdownMenuItem>
                            {link.status === 'ACTIVE' && (
                              <DropdownMenuItem
                                onClick={() => handlePause(link)}
                              >
                                <Pause className="mr-2 h-4 w-4" />
                                Pause
                              </DropdownMenuItem>
                            )}
                            {(link.status === 'PAUSED' ||
                              link.status === 'ARCHIVED') && (
                              <DropdownMenuItem
                                onClick={() => handleActivate(link)}
                              >
                                <Play className="mr-2 h-4 w-4" />
                                Activate
                              </DropdownMenuItem>
                            )}
                            {link.status !== 'ARCHIVED' && (
                              <DropdownMenuItem
                                onClick={() => handleArchive(link)}
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                Archive
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(link)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {data.pagination.page} of {data.pagination.totalPages} ·{' '}
              {data.pagination.totalItems} link
              {data.pagination.totalItems === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <CreateLinkDialog
        workspaceId={currentWorkspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => invalidate()}
      />
      {editingLink && (
        <EditLinkDialog
          workspaceId={currentWorkspaceId}
          link={editingLink}
          open={Boolean(editingLink)}
          onOpenChange={(open) => !open && setEditingLink(null)}
          onUpdated={() => {
            invalidate();
            setEditingLink(null);
          }}
        />
      )}
    </div>
  );
}
