'use client';

import type { CreatedWebhookEndpointDto } from '@linkiq/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@linkiq/ui';
import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { rotateWebhookSecret } from '@/lib/webhooks-api';
import { ApiError } from '@/providers/auth-provider';

interface RotateSecretDialogProps {
  workspaceId: string;
  endpointId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRotated: (endpoint: CreatedWebhookEndpointDto) => void;
}

export function RotateSecretDialog({
  workspaceId,
  endpointId,
  open,
  onOpenChange,
  onRotated,
}: RotateSecretDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [rotatedEndpoint, setRotatedEndpoint] =
    React.useState<CreatedWebhookEndpointDto | null>(null);
  const [copied, setCopied] = React.useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setRotatedEndpoint(null);
      setCopied(false);
    }
    onOpenChange(next);
  }

  async function handleRotate() {
    setIsSubmitting(true);
    try {
      const endpoint = await rotateWebhookSecret(workspaceId, endpointId);
      setRotatedEndpoint(endpoint);
      onRotated(endpoint);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to rotate signing secret',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copySecret() {
    if (!rotatedEndpoint) return;
    await navigator.clipboard.writeText(rotatedEndpoint.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {rotatedEndpoint ? (
          <>
            <DialogHeader>
              <DialogTitle>Signing secret rotated</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Your new signing secret will only be shown once. Copy it now —
                LinkIQ cannot display it again.
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-sm font-medium">
                  {rotatedEndpoint.secret}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={copySecret}
                  aria-label="Copy signing secret"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Rotate signing secret?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              The current secret will stop working immediately. Any deployed
              integration that verifies signatures with it will start
              rejecting deliveries until it&rsquo;s updated with the new secret.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleRotate} disabled={isSubmitting}>
                {isSubmitting ? 'Rotating…' : 'Rotate secret'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
