'use client';

import type { AdminWebhookEndpointListItemDto, TimeRangeValue } from '@linkiq/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { PaginationFooter } from '@/components/admin/pagination-footer';
import { StatusBadge } from '@/components/admin/status-badge';
import {
  getWebhookOpsOverview,
  listEndpointDeliveries,
  listWebhookEndpoints,
  retryEndpointDelivery,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PAGE_SIZE = 20;
const RANGE_OPTIONS: { label: string; value: TimeRangeValue }[] = [
  { label: 'Today', value: 'today' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function DeliveriesDialog({
  endpoint,
  onClose,
}: {
  endpoint: AdminWebhookEndpointListItemDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin', 'webhooks', 'deliveries', endpoint.id, page],
    queryFn: () => listEndpointDeliveries(endpoint.id, page, PAGE_SIZE),
  });

  async function handleRetry(deliveryId: string) {
    setBusyId(deliveryId);
    try {
      await retryEndpointDelivery(endpoint.id, deliveryId);
      toast.success('Retry queued');
      queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks', 'deliveries', endpoint.id] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to retry delivery');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{endpoint.name} — deliveries</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{endpoint.url}</p>
        {!data ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No deliveries yet.</p>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead>Last attempt</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                      <TableCell>
                        <StatusBadge status={d.status} />
                      </TableCell>
                      <TableCell>{d.attemptCount}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {d.responseStatus ?? d.failureReason ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(d.lastAttemptAt)}</TableCell>
                      <TableCell>
                        {(d.status === 'FAILED' || d.status === 'EXHAUSTED') && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === d.id}
                            onClick={() => handleRetry(d.id)}
                          >
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationFooter pagination={data.pagination} onPageChange={setPage} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminWebhooksPage() {
  const [range, setRange] = React.useState<TimeRangeValue>('7d');
  const [page, setPage] = React.useState(1);
  const [selectedEndpoint, setSelectedEndpoint] = React.useState<AdminWebhookEndpointListItemDto | null>(
    null,
  );

  const { data: overview, isLoading: overviewLoading, isError: overviewError, error: overviewErr } =
    useQuery({
      queryKey: ['admin', 'webhooks', 'overview', range],
      queryFn: () => getWebhookOpsOverview(range),
    });

  const { data: endpoints, isLoading: endpointsLoading } = useQuery({
    queryKey: ['admin', 'webhooks', 'endpoints', page],
    queryFn: () => listWebhookEndpoints(page, PAGE_SIZE),
  });

  return (
    <div>
      <AdminPageHeader
        title="Webhook Operations"
        description="Outbound webhook delivery health across every workspace. Secrets are never shown."
        actions={RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={range === opt.value ? 'default' : 'outline'}
            onClick={() => setRange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      />

      {overviewLoading && (
        <div role="status" aria-live="polite" className="py-6 text-center text-muted-foreground">
          Loading overview…
        </div>
      )}
      {overviewError && (
        <div role="alert" className="py-6 text-center text-destructive">
          {overviewErr instanceof ApiError ? overviewErr.message : 'Failed to load webhook overview.'}
        </div>
      )}

      {overview && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Endpoints</CardDescription>
              <CardTitle className="text-2xl">{overview.endpointCount}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {overview.activeEndpointCount} active
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Success rate (range)</CardDescription>
              <CardTitle className="text-2xl">
                {overview.successRate === null ? '—' : `${Math.round(overview.successRate * 100)}%`}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed (range)</CardDescription>
              <CardTitle className="text-2xl">{overview.deliveriesByStatus.FAILED}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Exhausted (range)</CardDescription>
              <CardTitle className="text-2xl">{overview.deliveriesByStatus.EXHAUSTED}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Endpoints</h2>
      {endpointsLoading && (
        <div role="status" aria-live="polite" className="py-6 text-center text-muted-foreground">
          Loading endpoints…
        </div>
      )}
      {endpoints && endpoints.items.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No webhook endpoints configured anywhere on the platform.
        </div>
      )}
      {endpoints && endpoints.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Consecutive failures</TableHead>
                  <TableHead>Last delivery</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.items.map((endpoint) => (
                  <TableRow key={endpoint.id}>
                    <TableCell>
                      <div className="font-medium">{endpoint.name}</div>
                      <div className="text-xs text-muted-foreground">{endpoint.url}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{endpoint.workspaceName}</TableCell>
                    <TableCell>
                      <StatusBadge status={endpoint.status} />
                    </TableCell>
                    <TableCell>{endpoint.consecutiveFailures}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(endpoint.lastDeliveryAt)}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setSelectedEndpoint(endpoint)}>
                        View deliveries
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationFooter pagination={endpoints.pagination} onPageChange={setPage} />
        </>
      )}

      {selectedEndpoint && (
        <DeliveriesDialog endpoint={selectedEndpoint} onClose={() => setSelectedEndpoint(null)} />
      )}
    </div>
  );
}
