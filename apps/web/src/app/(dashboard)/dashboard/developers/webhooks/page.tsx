'use client';

import type { WebhookEndpointDto } from '@linkiq/types';
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
import { ArrowLeft, KeyRound, MoreHorizontal, Pause, Play, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { CreateWebhookDialog } from '@/components/webhooks/create-webhook-dialog';
import { RotateSecretDialog } from '@/components/webhooks/rotate-secret-dialog';
import { WebhookStatusBadge } from '@/components/webhooks/webhook-status-badge';
import {
  activateWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  pauseWebhookEndpoint,
} from '@/lib/webhooks-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function WebhooksListPage() {
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  // Mirrors the API-keys page: webhook management is ADMIN/OWNER only.
  const canManage = currentRole === 'OWNER' || currentRole === 'ADMIN';

  const [createOpen, setCreateOpen] = React.useState(false);
  const [rotatingEndpointId, setRotatingEndpointId] = React.useState<
    string | null
  >(null);

  const queryKey = ['webhooks', currentWorkspaceId];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => listWebhookEndpoints(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey });
  }

  async function handlePause(endpoint: WebhookEndpointDto) {
    try {
      await pauseWebhookEndpoint(currentWorkspaceId!, endpoint.id);
      toast.success('Webhook endpoint paused');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to pause endpoint',
      );
    }
  }

  async function handleActivate(endpoint: WebhookEndpointDto) {
    try {
      await activateWebhookEndpoint(currentWorkspaceId!, endpoint.id);
      toast.success('Webhook endpoint activated');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to activate endpoint',
      );
    }
  }

  async function handleDelete(endpoint: WebhookEndpointDto) {
    if (
      !window.confirm(
        `Permanently delete "${endpoint.name}"? It will stop receiving events immediately.`,
      )
    ) {
      return;
    }
    try {
      await deleteWebhookEndpoint(currentWorkspaceId!, endpoint.id);
      toast.success('Webhook endpoint deleted');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete endpoint',
      );
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view webhook endpoints.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/developers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Developers
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
          <p className="text-muted-foreground">
            Send LinkIQ events to your own endpoints in real time.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create endpoint
          </Button>
        )}
      </div>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-muted-foreground"
        >
          Loading webhook endpoints…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load webhook endpoints.'}
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No webhook endpoints yet.</p>
          {canManage && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first endpoint
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
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Last delivery</TableHead>
                <TableHead>Last success</TableHead>
                <TableHead>Last failure</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((endpoint) => (
                <TableRow key={endpoint.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/developers/webhooks/${endpoint.id}`}
                      className="hover:underline"
                    >
                      {endpoint.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">
                    {endpoint.url}
                  </TableCell>
                  <TableCell>
                    <WebhookStatusBadge status={endpoint.status} />
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={endpoint.events.join(', ')}
                  >
                    {endpoint.events.length} event
                    {endpoint.events.length === 1 ? '' : 's'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(endpoint.lastDeliveryAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(endpoint.lastSuccessAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(endpoint.lastFailureAt)}
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Webhook endpoint actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/developers/webhooks/${endpoint.id}`}
                            >
                              View details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {endpoint.status === 'PAUSED' ||
                          endpoint.status === 'DISABLED' ? (
                            <DropdownMenuItem
                              onClick={() => handleActivate(endpoint)}
                            >
                              <Play className="mr-2 h-4 w-4" />
                              Activate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handlePause(endpoint)}
                            >
                              <Pause className="mr-2 h-4 w-4" />
                              Pause
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => setRotatingEndpointId(endpoint.id)}
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Rotate secret
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(endpoint)}
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

      <CreateWebhookDialog
        workspaceId={currentWorkspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => invalidate()}
      />

      {rotatingEndpointId && (
        <RotateSecretDialog
          workspaceId={currentWorkspaceId}
          endpointId={rotatingEndpointId}
          open={Boolean(rotatingEndpointId)}
          onOpenChange={(open) => {
            if (!open) setRotatingEndpointId(null);
          }}
          onRotated={() => invalidate()}
        />
      )}
    </div>
  );
}
