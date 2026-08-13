'use client';

import type { WebhookDeliveryStatus } from '@linkiq/types';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  KeyRound,
  Pause,
  Play,
  Send,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { DeliveryDetailDialog } from '@/components/webhooks/delivery-detail-dialog';
import { DeliveryStatusBadge } from '@/components/webhooks/delivery-status-badge';
import { WEBHOOK_EVENT_LABELS } from '@/components/webhooks/event-catalog';
import { RotateSecretDialog } from '@/components/webhooks/rotate-secret-dialog';
import { WebhookStatusBadge } from '@/components/webhooks/webhook-status-badge';
import {
  activateWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookDeliveries,
  pauseWebhookEndpoint,
  sendTestWebhookEvent,
} from '@/lib/webhooks-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

const PAGE_SIZE = 20;

const DELIVERY_STATUS_FILTERS: {
  label: string;
  value: WebhookDeliveryStatus | 'ALL';
}[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Processing', value: 'PROCESSING' },
  { label: 'Delivered', value: 'DELIVERED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Exhausted', value: 'EXHAUSTED' },
];

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function WebhookDetailPage() {
  const params = useParams<{ id: string }>();
  const endpointId = params.id;
  const router = useRouter();
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  const canManage = currentRole === 'OWNER' || currentRole === 'ADMIN';

  const [statusFilter, setStatusFilter] = React.useState<
    WebhookDeliveryStatus | 'ALL'
  >('ALL');
  const [page, setPage] = React.useState(1);
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [selectedDeliveryId, setSelectedDeliveryId] = React.useState<
    string | null
  >(null);
  const [isSendingTest, setIsSendingTest] = React.useState(false);

  const endpointQueryKey = ['webhooks', currentWorkspaceId, endpointId];
  const deliveriesQueryKey = [
    'webhook-deliveries',
    currentWorkspaceId,
    endpointId,
    page,
    statusFilter,
  ];

  const endpoint = useQuery({
    queryKey: endpointQueryKey,
    queryFn: () => getWebhookEndpoint(currentWorkspaceId!, endpointId),
    enabled: Boolean(currentWorkspaceId),
  });

  const deliveries = useQuery({
    queryKey: deliveriesQueryKey,
    queryFn: () =>
      listWebhookDeliveries(currentWorkspaceId!, endpointId, {
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      }),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidateEndpoint() {
    queryClient.invalidateQueries({ queryKey: endpointQueryKey });
  }

  function invalidateDeliveries() {
    queryClient.invalidateQueries({
      queryKey: ['webhook-deliveries', currentWorkspaceId, endpointId],
    });
  }

  async function handlePause() {
    try {
      await pauseWebhookEndpoint(currentWorkspaceId!, endpointId);
      toast.success('Webhook endpoint paused');
      invalidateEndpoint();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to pause endpoint',
      );
    }
  }

  async function handleActivate() {
    try {
      await activateWebhookEndpoint(currentWorkspaceId!, endpointId);
      toast.success('Webhook endpoint activated');
      invalidateEndpoint();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to activate endpoint',
      );
    }
  }

  async function handleDelete() {
    if (
      !endpoint.data ||
      !window.confirm(
        `Permanently delete "${endpoint.data.name}"? It will stop receiving events immediately.`,
      )
    ) {
      return;
    }
    try {
      await deleteWebhookEndpoint(currentWorkspaceId!, endpointId);
      toast.success('Webhook endpoint deleted');
      router.push('/dashboard/developers/webhooks');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete endpoint',
      );
    }
  }

  async function handleSendTest() {
    setIsSendingTest(true);
    try {
      await sendTestWebhookEvent(currentWorkspaceId!, endpointId);
      toast.success('Test event sent');
      invalidateDeliveries();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to send test event',
      );
    } finally {
      setIsSendingTest(false);
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view this webhook endpoint.
      </p>
    );
  }

  if (endpoint.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="py-12 text-center text-muted-foreground"
      >
        Loading webhook endpoint…
      </div>
    );
  }

  if (endpoint.isError || !endpoint.data) {
    return (
      <div role="alert" className="py-12 text-center text-destructive">
        {endpoint.error instanceof ApiError
          ? endpoint.error.message
          : 'Failed to load this webhook endpoint.'}
      </div>
    );
  }

  const data = endpoint.data;

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/developers/webhooks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Webhooks
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {data.name}
            </h1>
            <WebhookStatusBadge status={data.status} />
          </div>
          <p className="mt-1 text-muted-foreground">{data.url}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleSendTest}
              disabled={isSendingTest}
            >
              <Send className="mr-2 h-4 w-4" />
              {isSendingTest ? 'Sending…' : 'Send test event'}
            </Button>
            {data.status === 'PAUSED' || data.status === 'DISABLED' ? (
              <Button variant="outline" onClick={handleActivate}>
                <Play className="mr-2 h-4 w-4" />
                Activate
              </Button>
            ) : (
              <Button variant="outline" onClick={handlePause}>
                <Pause className="mr-2 h-4 w-4" />
                Pause
              </Button>
            )}
            <Button variant="outline" onClick={() => setRotateOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              Rotate secret
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Endpoint details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Secret prefix</p>
              <code className="text-sm font-medium">{data.secretPrefix}</code>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Consecutive failures
              </p>
              <p className="font-medium">{data.consecutiveFailures}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="font-medium">{formatDateTime(data.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last delivery</p>
              <p className="font-medium">
                {formatDateTime(data.lastDeliveryAt)}
              </p>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">
              Subscribed events ({data.events.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.events.map((event) => (
                <span
                  key={event}
                  className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs"
                >
                  {WEBHOOK_EVENT_LABELS[event]}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1">
            {DELIVERY_STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                size="sm"
                variant={statusFilter === filter.value ? 'default' : 'outline'}
                onClick={() => {
                  setStatusFilter(filter.value);
                  setPage(1);
                }}
              >
                {filter.label}
              </Button>
            ))}
          </div>

          {deliveries.isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading deliveries…
            </p>
          )}

          {deliveries.isError && (
            <p className="py-8 text-center text-sm text-destructive">
              {deliveries.error instanceof ApiError
                ? deliveries.error.message
                : 'Failed to load deliveries.'}
            </p>
          )}

          {deliveries.data && deliveries.data.items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No deliveries yet.
            </p>
          )}

          {deliveries.data && deliveries.data.items.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last attempt</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.data.items.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="font-medium">
                        {delivery.eventType}
                      </TableCell>
                      <TableCell>
                        <DeliveryStatusBadge status={delivery.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {delivery.attemptCount}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {delivery.responseStatus ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(delivery.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(delivery.lastAttemptAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedDeliveryId(delivery.id)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {deliveries.data.pagination.page} of{' '}
                  {deliveries.data.pagination.totalPages} ·{' '}
                  {deliveries.data.pagination.totalItems}{' '}
                  {deliveries.data.pagination.totalItems === 1
                    ? 'delivery'
                    : 'deliveries'}
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
                    disabled={page >= deliveries.data.pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <RotateSecretDialog
        workspaceId={currentWorkspaceId}
        endpointId={endpointId}
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        onRotated={() => invalidateEndpoint()}
      />

      <DeliveryDetailDialog
        workspaceId={currentWorkspaceId}
        endpointId={endpointId}
        deliveryId={selectedDeliveryId}
        onOpenChange={(open) => {
          if (!open) setSelectedDeliveryId(null);
        }}
        canManage={canManage}
      />
    </div>
  );
}
