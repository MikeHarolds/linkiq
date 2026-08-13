'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreatedWebhookEndpointDto, WebhookEventTypeName } from '@linkiq/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@linkiq/ui';
import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  createWebhookEndpointSchema,
  type CreateWebhookEndpointFormValues,
} from '@/lib/validations/webhooks';
import { createWebhookEndpoint } from '@/lib/webhooks-api';
import { ApiError } from '@/providers/auth-provider';

import { WEBHOOK_EVENT_GROUPS, WEBHOOK_EVENT_LABELS } from './event-catalog';

interface CreateWebhookDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (endpoint: CreatedWebhookEndpointDto) => void;
}

export function CreateWebhookDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: CreateWebhookDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [createdEndpoint, setCreatedEndpoint] =
    React.useState<CreatedWebhookEndpointDto | null>(null);
  const [copied, setCopied] = React.useState(false);
  // Deliberately starts empty — there is no implicit "subscribe to
  // everything" default; the caller must explicitly pick at least one event.
  const [events, setEvents] = React.useState<Set<WebhookEventTypeName>>(
    new Set(),
  );
  const [eventsError, setEventsError] = React.useState<string | null>(null);

  const form = useForm<CreateWebhookEndpointFormValues>({
    resolver: zodResolver(createWebhookEndpointSchema),
    defaultValues: { name: '', url: '' },
  });

  function toggleEvent(event: WebhookEventTypeName) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
    setEventsError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setCreatedEndpoint(null);
      setCopied(false);
      setEvents(new Set());
      setEventsError(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(values: CreateWebhookEndpointFormValues) {
    if (events.size === 0) {
      setEventsError('Select at least one event.');
      return;
    }
    setIsSubmitting(true);
    try {
      const endpoint = await createWebhookEndpoint(workspaceId, {
        name: values.name,
        url: values.url,
        events: Array.from(events),
      });
      setCreatedEndpoint(endpoint);
      onCreated(endpoint);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to create webhook endpoint',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copySecret() {
    if (!createdEndpoint) return;
    await navigator.clipboard.writeText(createdEndpoint.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {createdEndpoint ? (
          <>
            <DialogHeader>
              <DialogTitle>Webhook endpoint created</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Your signing secret will only be shown once. Copy it now —
                LinkIQ cannot display it again.
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-sm font-medium">
                  {createdEndpoint.secret}
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
              <DialogTitle>Create webhook endpoint</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Production notifications" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Endpoint URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://example.com/webhooks/linkiq"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <p className="text-sm font-medium leading-none">Events</p>
                  <p className="text-xs text-muted-foreground">
                    This endpoint only receives what you select here —
                    nothing is subscribed by default.
                  </p>
                  <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border p-3">
                    {WEBHOOK_EVENT_GROUPS.map((group) => (
                      <div key={group.label} className="space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground">
                          {group.label}
                        </p>
                        {group.events.map((event) => (
                          <label
                            key={event}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input"
                              checked={events.has(event)}
                              onChange={() => toggleEvent(event)}
                            />
                            {WEBHOOK_EVENT_LABELS[event]}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  {eventsError && (
                    <p className="text-sm font-medium text-destructive">
                      {eventsError}
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating…' : 'Create endpoint'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
