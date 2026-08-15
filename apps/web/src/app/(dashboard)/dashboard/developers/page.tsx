'use client';

import type { ApiKeyDto } from '@linkiq/types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink,
  MoreHorizontal,
  Plus,
  ShieldOff,
  Trash2,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { ApiKeyStatusBadge } from '@/components/api-keys/api-key-status-badge';
import { CreateApiKeyDialog } from '@/components/api-keys/create-api-key-dialog';
import { PERMISSION_LABELS } from '@/components/api-keys/permission-labels';
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import { deleteApiKey, listApiKeys, revokeApiKey } from '@/lib/api-keys-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

// NEXT_PUBLIC_API_URL already includes the /api/v1 segment (see
// lib/api-client.ts) — the base URL developers call is exactly this
// value, and Swagger is mounted one level below it, at /docs.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const API_DOCS_URL = `${API_BASE_URL}/docs`;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function DevelopersDashboardPage() {
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  // Credential management is ADMIN/OWNER only — deliberately narrower
  // than the domains/links MEMBER-can-mutate precedent, matching Sprint
  // 7's billing dashboard for the same reason (see
  // docs/architecture/api-keys.md §Permissions).
  const canManage = currentRole === 'OWNER' || currentRole === 'ADMIN';

  const [createOpen, setCreateOpen] = React.useState(false);

  const queryKey = ['api-keys', currentWorkspaceId];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => listApiKeys(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey });
  }

  async function handleRevoke(apiKey: ApiKeyDto) {
    if (
      !window.confirm(
        `Revoke "${apiKey.name}"? Any application using this key will immediately start receiving 401 errors.`,
      )
    ) {
      return;
    }
    try {
      await revokeApiKey(currentWorkspaceId!, apiKey.id);
      toast.success('API key revoked');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to revoke API key',
      );
    }
  }

  async function handleDelete(apiKey: ApiKeyDto) {
    if (!window.confirm(`Permanently delete "${apiKey.name}"?`)) {
      return;
    }
    try {
      await deleteApiKey(currentWorkspaceId!, apiKey.id);
      toast.success('API key deleted');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete API key',
      );
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view developer settings.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Developers"
        description="Create API keys to access LinkIQ programmatically."
        actions={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create API key
            </Button>
          )
        }
      />

      {/* Terminal-style code panel — deliberately fixed dark colors
          (not theme tokens) since a code/terminal surface is a
          recognizable, intentional visual element that reads fine
          regardless of the surrounding page theme. */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#05080D] text-sm shadow-[0_8px_24px_-12px_hsl(0_0%_0%/0.6)]">
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-2 font-mono text-xs text-[#94A3B8]">
            quick start
          </span>
        </div>
        <div className="space-y-2 p-4 font-mono text-[13px] leading-relaxed">
          <p className="text-[#94A3B8]">
            <span className="text-[#FF8A3D]"># Base URL</span>
          </p>
          <p className="text-[#F8FAFC]">{API_BASE_URL}</p>
          <p className="mt-3 text-[#94A3B8]">
            <span className="text-[#FF8A3D]"># Authenticate</span>
          </p>
          <p className="text-[#F8FAFC]">
            <span className="text-[#FF8A3D]">Authorization:</span> Bearer
            lk_live_...
          </p>
        </div>
        <div className="border-t border-white/10 px-4 py-2.5">
          <a
            href={API_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-[#FF8A3D] hover:underline"
          >
            Full API documentation
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <Link
        href="/dashboard/developers/webhooks"
        className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Webhook className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium">Webhooks</p>
            <p className="text-sm text-muted-foreground">
              Manage endpoints and view delivery history for LinkIQ events.
            </p>
          </div>
        </div>
      </Link>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-muted-foreground"
        >
          Loading API keys…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load API keys.'}
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No API keys yet.</p>
          {canManage && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first API key
            </Button>
          )}
        </div>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell className="font-medium">{apiKey.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                      {apiKey.keyPrefix}••••••••
                    </code>
                  </TableCell>
                  <TableCell className="max-w-xs text-xs text-muted-foreground">
                    {apiKey.permissions
                      .map((p) => PERMISSION_LABELS[p])
                      .join(', ')}
                  </TableCell>
                  <TableCell>
                    <ApiKeyStatusBadge status={apiKey.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(apiKey.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(apiKey.lastUsedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(apiKey.expiresAt)}
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="API key actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {apiKey.status === 'ACTIVE' && (
                            <DropdownMenuItem
                              onClick={() => handleRevoke(apiKey)}
                            >
                              <ShieldOff className="mr-2 h-4 w-4" />
                              Revoke
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(apiKey)}
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
      )}

      <CreateApiKeyDialog
        workspaceId={currentWorkspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => invalidate()}
      />
    </div>
  );
}
