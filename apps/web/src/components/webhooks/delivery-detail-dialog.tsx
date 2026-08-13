'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { getWebhookDelivery, retryWebhookDelivery } from '@/lib/webhooks-api';
import { ApiError } from '@/providers/auth-provider';

import { DeliveryStatusBadge } from './delivery-status-badge';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

interface DeliveryDetailDialogProps {
  workspaceId: string;
  endpointId: string;
  deliveryId: string | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}

export function DeliveryDetailDialog({
  workspaceId,
  endpointId,
  deliveryId,
  onOpenChange,
  canManage,
}: DeliveryDetailDialogProps) {
  const queryClient = useQueryClient();
  const [isRetrying, setIsRetrying] = React.useState(false);

  const queryKey = ['webhook-delivery', workspaceId, endpointId, deliveryId];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => getWebhookDelivery(workspaceId, endpointId, deliveryId!),
    enabled: Boolean(deliveryId),
  });

  async function handleRetry() {
    if (!deliveryId) return;
    setIsRetrying(true);
    try {
      await retryWebhookDelivery(workspaceId, endpointId, deliveryId);
      toast.success('Retry queued');
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({
        queryKey: ['webhook-deliveries', workspaceId, endpointId],
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to retry delivery',
      );
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <Dialog open={Boolean(deliveryId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Delivery detail</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading delivery…
          </p>
        )}

        {isError && (
          <p className="py-8 text-center text-sm text-destructive">
            {error instanceof ApiError
              ? error.message
              : 'Failed to load delivery.'}
          </p>
        )}

        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Event type</p>
                <p className="font-medium">{data.event.type}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <DeliveryStatusBadge status={data.status} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Attempt count</p>
                <p className="font-medium">{data.attemptCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Response status
                </p>
                <p className="font-medium">
                  {data.responseStatus ?? '—'}
                  {data.responseTimeMs !== null &&
                    ` (${data.responseTimeMs}ms)`}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="font-medium">{formatDateTime(data.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last attempt</p>
                <p className="font-medium">
                  {formatDateTime(data.lastAttemptAt)}
                </p>
              </div>
              {data.failureReason && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">
                    Failure reason
                  </p>
                  <p className="font-medium text-destructive">
                    {data.failureReason}
                  </p>
                </div>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                Event payload
              </p>
              <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                {JSON.stringify(data.event, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          {canManage &&
            data &&
            (data.status === 'FAILED' || data.status === 'EXHAUSTED') && (
              <Button
                variant="outline"
                onClick={handleRetry}
                disabled={isRetrying}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {isRetrying ? 'Retrying…' : 'Retry'}
              </Button>
            )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
