'use client';

import type { SubscriptionStatus } from '@linkiq/types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { PaginationFooter } from '@/components/admin/pagination-footer';
import { StatusBadge } from '@/components/admin/status-badge';
import {
  cancelWorkspaceSubscription,
  changeWorkspacePlan,
  extendWorkspaceTrial,
  listPlans,
  listSubscriptions,
  reactivateWorkspaceSubscription,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: SubscriptionStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Trialing', value: 'TRIALING' },
  { label: 'Past due', value: 'PAST_DUE' },
  { label: 'Canceled', value: 'CANCELED' },
  { label: 'Expired', value: 'EXPIRED' },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export default function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState<SubscriptionStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [busyWorkspaceId, setBusyWorkspaceId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'subscriptions', page, debouncedSearch, status],
    queryFn: () =>
      listSubscriptions({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined, status }),
  });

  const { data: plans } = useQuery({ queryKey: ['admin', 'plans'], queryFn: listPlans });
  const purchasablePlans = (plans ?? []).filter((p) => p.isActive);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
  }

  async function withBusy(workspaceId: string, action: () => Promise<unknown>, successMessage: string) {
    setBusyWorkspaceId(workspaceId);
    try {
      await action();
      toast.success(successMessage);
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusyWorkspaceId(null);
    }
  }

  async function handleChangePlan(workspaceId: string, planSlug: string) {
    await withBusy(
      workspaceId,
      () => changeWorkspacePlan(workspaceId, planSlug),
      'Plan change applied (or checkout initiated)',
    );
  }

  async function handleCancel(workspaceId: string) {
    if (!window.confirm('Cancel this subscription at the end of the current period?')) return;
    await withBusy(workspaceId, () => cancelWorkspaceSubscription(workspaceId), 'Cancellation scheduled');
  }

  async function handleReactivate(workspaceId: string) {
    await withBusy(workspaceId, () => reactivateWorkspaceSubscription(workspaceId), 'Subscription reactivated');
  }

  async function handleExtendTrial(workspaceId: string) {
    const input = window.prompt('New trial end date (YYYY-MM-DD):');
    if (!input) return;
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      toast.error('Invalid date');
      return;
    }
    await withBusy(
      workspaceId,
      () => extendWorkspaceTrial(workspaceId, date.toISOString()),
      'Trial extended',
    );
  }

  return (
    <div>
      <AdminPageHeader title="Subscriptions" description="Every workspace subscription on the platform." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search subscriptions"
          placeholder="Search by workspace name or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.label}
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

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading subscriptions…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load subscriptions.'}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No subscriptions match this filter.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell>
                      <Link href={`/admin/workspaces/${sub.workspaceId}`} className="font-medium hover:underline">
                        {sub.workspace.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sub.workspace.organization.owner.email}
                    </TableCell>
                    <TableCell>{sub.plan.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={sub.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{sub.provider ?? 'development'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(sub.currentPeriodEnd)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busyWorkspaceId === sub.workspaceId}
                            aria-label="Subscription actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Change plan</DropdownMenuLabel>
                          {purchasablePlans.map((plan) => (
                            <DropdownMenuItem
                              key={plan.slug}
                              onClick={() => handleChangePlan(sub.workspaceId, plan.slug)}
                            >
                              {plan.name}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          {sub.status === 'TRIALING' && (
                            <DropdownMenuItem onClick={() => handleExtendTrial(sub.workspaceId)}>
                              Extend trial
                            </DropdownMenuItem>
                          )}
                          {sub.cancelAt ? (
                            <DropdownMenuItem onClick={() => handleReactivate(sub.workspaceId)}>
                              Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleCancel(sub.workspaceId)}>
                              Cancel
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationFooter pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
