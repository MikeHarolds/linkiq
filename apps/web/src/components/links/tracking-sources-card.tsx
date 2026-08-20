'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import {
  deleteLinkSource,
  listLinkSources,
  updateLinkSource,
  type LinkSourceWithStatsDto,
} from '@/lib/link-sources-api';
import { ApiError } from '@/providers/auth-provider';

import { CreateLinkSourceDialog } from './create-link-source-dialog';
import { EditLinkSourceDialog } from './edit-link-source-dialog';

interface TrackingSourcesCardProps {
  workspaceId: string;
  linkId: string;
  canManage: boolean;
}

export function TrackingSourcesCard({
  workspaceId,
  linkId,
  canManage,
}: TrackingSourcesCardProps) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LinkSourceWithStatsDto | null>(
    null,
  );
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['link-sources', workspaceId, linkId],
    queryFn: () => listLinkSources(workspaceId, linkId),
    enabled: Boolean(workspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ['link-sources', workspaceId, linkId],
    });
  }

  async function handleCopy(source: LinkSourceWithStatsDto) {
    await navigator.clipboard.writeText(source.trackingUrl);
    setCopiedId(source.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleToggleActive(source: LinkSourceWithStatsDto) {
    try {
      await updateLinkSource(workspaceId, source.id, {
        isActive: !source.isActive,
      });
      toast.success(
        source.isActive ? 'Source deactivated' : 'Source activated',
      );
      invalidate();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to update source',
      );
    }
  }

  async function handleDelete(source: LinkSourceWithStatsDto) {
    if (
      !window.confirm(
        `Delete the "${source.name}" tracking source? Existing click history stays intact.`,
      )
    ) {
      return;
    }
    try {
      await deleteLinkSource(workspaceId, source.id);
      toast.success('Tracking source deleted');
      invalidate();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to delete source',
      );
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Tracking Sources</CardTitle>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add tracking source
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {sources.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading tracking sources…
          </p>
        ) : sources.isError ? (
          <p className="text-sm text-destructive">
            Failed to load tracking sources.
          </p>
        ) : !sources.data || sources.data.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No tracking sources for this link yet. Add one to reliably
              attribute WhatsApp, Facebook, Instagram, or Email traffic — even
              when the originating app sends no referrer.
            </p>
            {canManage && (
              <Button
                className="mt-4"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add one
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Medium</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.data.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{source.name}</span>
                        {!source.isActive && (
                          <Badge variant="secondary">Deactivated</Badge>
                        )}
                      </div>
                      <code className="text-xs text-muted-foreground">
                        {source.source}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {source.medium}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {source.campaign ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {source.clickCount}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Tracking source actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleCopy(source)}>
                            <Copy className="mr-2 h-4 w-4" />
                            {copiedId === source.id ? 'Copied!' : 'Copy link'}
                          </DropdownMenuItem>
                          {canManage && (
                            <>
                              <DropdownMenuItem
                                onClick={() => setEditing(source)}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleToggleActive(source)}
                              >
                                {source.isActive ? 'Deactivate' : 'Activate'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(source)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <CreateLinkSourceDialog
        workspaceId={workspaceId}
        linkId={linkId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => invalidate()}
      />
      {editing && (
        <EditLinkSourceDialog
          workspaceId={workspaceId}
          source={editing}
          open={Boolean(editing)}
          onOpenChange={(open) => !open && setEditing(null)}
          onUpdated={() => {
            invalidate();
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}
