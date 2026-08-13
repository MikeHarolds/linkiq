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
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { ApiKeyStatusBadge } from '@/components/api-keys/api-key-status-badge';
import { CreateApiKeyDialog } from '@/components/api-keys/create-api-key-dialog';
import { PERMISSION_LABELS } from '@/components/api-keys/permission-labels';
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Developers</h1>
          <p className="text-muted-foreground">
            Create API keys to access LinkIQ programmatically.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create API key
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Quick start</p>
        <p className="mt-1 text-muted-foreground">
          Base URL:{' '}
          <code className="rounded bg-muted px-1 py-0.5">{API_BASE_URL}</code>
        </p>
        <p className="mt-1 text-muted-foreground">
          Authenticate with{' '}
          <code className="rounded bg-muted px-1 py-0.5">
            Authorization: Bearer lk_live_...
          </code>
        </p>
        <a
          href={API_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
        >
          Full API documentation
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

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
        <div className="rounded-md border">
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
                    <code className="text-xs text-muted-foreground">
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
