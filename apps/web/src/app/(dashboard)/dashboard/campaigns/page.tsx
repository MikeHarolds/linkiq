'use client';

import type {
  CampaignDto,
  CampaignListItemDto,
  CampaignStatus,
} from '@linkiq/types';
import {
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
  Megaphone,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { CreateCampaignDialog } from '@/components/campaigns/create-campaign-dialog';
import { EditCampaignDialog } from '@/components/campaigns/edit-campaign-dialog';
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import {
  activateCampaign,
  archiveCampaign,
  deleteCampaign,
  listCampaigns,
  pauseCampaign,
} from '@/lib/campaigns-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: CampaignStatus | 'ALL' }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Paused', value: 'PAUSED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Archived', value: 'ARCHIVED' },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function CampaignsDashboardPage() {
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  const canManage =
    currentRole === 'OWNER' ||
    currentRole === 'ADMIN' ||
    currentRole === 'MEMBER';

  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState<CampaignStatus | 'ALL'>('ALL');
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingCampaign, setEditingCampaign] =
    React.useState<CampaignListItemDto | null>(null);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const queryKey = [
    'campaigns',
    currentWorkspaceId,
    page,
    debouncedSearch,
    status,
  ];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      listCampaigns(currentWorkspaceId!, {
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        status: status === 'ALL' ? undefined : status,
      }),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ['campaigns', currentWorkspaceId],
    });
  }

  async function handlePause(campaign: CampaignListItemDto) {
    try {
      await pauseCampaign(currentWorkspaceId!, campaign.id);
      toast.success('Campaign paused');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to pause campaign',
      );
    }
  }

  async function handleActivate(campaign: CampaignListItemDto) {
    try {
      await activateCampaign(currentWorkspaceId!, campaign.id);
      toast.success('Campaign activated');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to activate campaign',
      );
    }
  }

  async function handleArchive(campaign: CampaignListItemDto) {
    try {
      await archiveCampaign(currentWorkspaceId!, campaign.id);
      toast.success('Campaign archived');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to archive campaign',
      );
    }
  }

  async function handleDelete(campaign: CampaignListItemDto) {
    if (
      !window.confirm(
        `Delete "${campaign.name}"? Its links will NOT be deleted or disabled — only the campaign record.`,
      )
    ) {
      return;
    }
    try {
      await deleteCampaign(currentWorkspaceId!, campaign.id);
      toast.success('Campaign deleted');
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete campaign',
      );
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view campaigns.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Campaigns"
        description="Group links for reporting and give them shared UTM defaults."
        actions={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create campaign
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by name or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
          aria-label="Search campaigns"
        />
        <div className="flex flex-wrap gap-1">
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
          Loading campaigns…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load campaigns.'}
        </div>
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <Megaphone
            className="mx-auto h-8 w-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="mt-3 text-muted-foreground">
            {debouncedSearch || status !== 'ALL'
              ? 'No campaigns match your filters.'
              : "You haven't created any campaigns yet."}
          </p>
          {canManage && !debouncedSearch && status === 'ALL' && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first campaign
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
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Links</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/campaigns/${campaign.id}`}
                        className="text-sm font-semibold hover:text-primary hover:underline"
                      >
                        {campaign.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {campaign.linkCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(campaign.startDate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(campaign.endDate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(campaign.createdAt)}
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Campaign actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setEditingCampaign(campaign)}
                            >
                              Edit
                            </DropdownMenuItem>
                            {(campaign.status === 'DRAFT' ||
                              campaign.status === 'PAUSED') && (
                              <DropdownMenuItem
                                onClick={() => handleActivate(campaign)}
                              >
                                <Play className="mr-2 h-4 w-4" />
                                Activate
                              </DropdownMenuItem>
                            )}
                            {campaign.status === 'ACTIVE' && (
                              <DropdownMenuItem
                                onClick={() => handlePause(campaign)}
                              >
                                <Pause className="mr-2 h-4 w-4" />
                                Pause
                              </DropdownMenuItem>
                            )}
                            {campaign.status !== 'ARCHIVED' && (
                              <DropdownMenuItem
                                onClick={() => handleArchive(campaign)}
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                Archive
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(campaign)}
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
              {data.pagination.totalItems} campaign
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

      <CreateCampaignDialog
        workspaceId={currentWorkspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => invalidate()}
      />
      {editingCampaign && (
        <EditCampaignDialog
          workspaceId={currentWorkspaceId}
          campaign={editingCampaign}
          open={Boolean(editingCampaign)}
          onOpenChange={(open) => !open && setEditingCampaign(null)}
          onUpdated={(updated: CampaignDto) => {
            void updated;
            invalidate();
            setEditingCampaign(null);
          }}
        />
      )}
    </div>
  );
}
