'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { DomainDto, LinkDto } from '@linkiq/types';
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
  Textarea,
} from '@linkiq/ui';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { listDomains } from '@/lib/domains-api';
import { updateLink } from '@/lib/links-api';
import {
  updateLinkSchema,
  type UpdateLinkFormValues,
} from '@/lib/validations/links';
import { ApiError } from '@/providers/auth-provider';

interface EditLinkDialogProps {
  workspaceId: string;
  link: LinkDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

/** Formats an ISO timestamp for an <input type="datetime-local"> value. */
function toDatetimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function EditLinkDialog({
  workspaceId,
  link,
  open,
  onOpenChange,
  onUpdated,
}: EditLinkDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [domains, setDomains] = React.useState<DomainDto[]>([]);

  const form = useForm<UpdateLinkFormValues>({
    resolver: zodResolver(updateLinkSchema),
    defaultValues: {
      destinationUrl: link.destinationUrl,
      title: link.title ?? '',
      description: link.description ?? '',
      expiresAt: toDatetimeLocal(link.expiresAt),
      customDomainId: link.customDomainId ?? '',
    },
  });

  React.useEffect(() => {
    if (!open) return;
    listDomains(workspaceId, { status: 'ACTIVE', pageSize: 100 })
      .then((res) => setDomains(res.items))
      .catch(() => {
        /* domain selection is optional — a failed fetch just means an
         * empty picker, not a broken dialog */
      });
  }, [open, workspaceId]);

  async function onSubmit(values: UpdateLinkFormValues) {
    setIsSubmitting(true);
    try {
      await updateLink(workspaceId, link.id, {
        destinationUrl: values.destinationUrl,
        title: values.title || undefined,
        description: values.description || undefined,
        expiresAt: values.expiresAt
          ? new Date(values.expiresAt).toISOString()
          : null,
        customDomainId: values.customDomainId || null,
      });
      toast.success('Link updated');
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to update link',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit link</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="destinationUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Destination URL</FormLabel>
                  <FormControl>
                    <Input type="url" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {domains.length > 0 && (
              <FormField
                control={form.control}
                name="customDomainId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Domain</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        {...field}
                      >
                        <option value="">LinkIQ default domain</option>
                        {domains.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.normalizedDomain}
                            {d.isPrimary ? ' (primary)' : ''}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expiresAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expiration date</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
