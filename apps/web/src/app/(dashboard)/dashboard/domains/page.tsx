'use client';

import type { DomainDto } from '@linkiq/types';
import {
  Badge,
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
  MoreHorizontal,
  Plus,
  Power,
  PowerOff,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { AddDomainDialog } from '@/components/domains/add-domain-dialog';
import { DomainStatusBadge } from '@/components/domains/domain-status-badge';
import {
  activateDomain,
  deleteDomain,
  disableDomain,
  listDomains,
  setPrimaryDomain,
  verifyDomain,
} from '@/lib/domains-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function DomainsDashboardPage() {
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  const canManage =
    currentRole === 'OWNER' ||
    currentRole === 'ADMIN' ||
    currentRole === 'MEMBER';

  const [addOpen, setAddOpen] = React.useState(false);

  const queryKey = ['domains', currentWorkspaceId];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => listDomains(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ['domains', currentWorkspaceId],
    });
  }

  async function handleVerify(domain: DomainDto) {
    try {
      const updated = await verifyDomain(currentWorkspaceId!, domain.id);
      toast[updated.status === 'VERIFIED' ? 'success' : 'error'](
        updated.status === 'VERIFIED'
          ? 'Domain verified'
          : 'Verification record not found — check your DNS settings and try again',
      );
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to verify domain',
      );
    }
  }

  async function handleActivate(domain: DomainDto) {
    try {
      await activateDomain(currentWorkspaceId!, domain.id);
      toast.success('Domain activated');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to activate domain',
      );
    }
  }

  async function handleDisable(domain: DomainDto) {
    try {
      await disableDomain(currentWorkspaceId!, domain.id);
      toast.success('Domain disabled');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to disable domain',
      );
    }
  }

  async function handleSetPrimary(domain: DomainDto) {
    try {
      await setPrimaryDomain(currentWorkspaceId!, domain.id);
      toast.success(`${domain.normalizedDomain} is now the primary domain`);
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to set primary domain',
      );
    }
  }

  async function handleDelete(domain: DomainDto) {
    if (
      !window.confirm(
        `Delete "${domain.normalizedDomain}"? Links using it will fall back to the default LinkIQ domain — they will NOT be deleted.`,
      )
    ) {
      return;
    }
    try {
      await deleteDomain(currentWorkspaceId!, domain.id);
      toast.success('Domain deleted');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete domain',
      );
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view domains.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Custom domains
          </h1>
          <p className="text-muted-foreground">
            Serve your short links from your own branded domain, e.g.{' '}
            <code>go.acme.com</code>.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add domain
          </Button>
        )}
      </div>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-muted-foreground"
        >
          Loading domains…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load domains.'}
        </div>
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">
            No custom domains yet — links use the default LinkIQ domain.
          </p>
          {canManage && (
            <Button className="mt-4" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add your first domain
            </Button>
          )}
        </div>
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((domain) => (
                <TableRow key={domain.id}>
                  <TableCell className="font-medium">
                    {domain.normalizedDomain}
                  </TableCell>
                  <TableCell>
                    <DomainStatusBadge status={domain.status} />
                  </TableCell>
                  <TableCell>
                    {domain.isPrimary && (
                      <Badge variant="secondary">Primary</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(domain.createdAt)}
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Domain actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(domain.status === 'PENDING' ||
                            domain.status === 'FAILED') && (
                            <DropdownMenuItem
                              onClick={() => handleVerify(domain)}
                            >
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              Verify
                            </DropdownMenuItem>
                          )}
                          {(domain.status === 'VERIFIED' ||
                            domain.status === 'DISABLED') && (
                            <DropdownMenuItem
                              onClick={() => handleActivate(domain)}
                            >
                              <Power className="mr-2 h-4 w-4" />
                              Activate
                            </DropdownMenuItem>
                          )}
                          {domain.status === 'ACTIVE' && (
                            <DropdownMenuItem
                              onClick={() => handleDisable(domain)}
                            >
                              <PowerOff className="mr-2 h-4 w-4" />
                              Disable
                            </DropdownMenuItem>
                          )}
                          {(domain.status === 'VERIFIED' ||
                            domain.status === 'ACTIVE') &&
                            !domain.isPrimary && (
                              <DropdownMenuItem
                                onClick={() => handleSetPrimary(domain)}
                              >
                                <Star className="mr-2 h-4 w-4" />
                                Set as primary
                              </DropdownMenuItem>
                            )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(domain)}
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

      <AddDomainDialog
        workspaceId={currentWorkspaceId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => invalidate()}
      />
    </div>
  );
}
