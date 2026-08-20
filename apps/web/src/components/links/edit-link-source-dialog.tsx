'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  updateLinkSource,
  type LinkSourceDto,
  type LinkSourceWithStatsDto,
} from '@/lib/link-sources-api';
import {
  linkSourceSchema,
  type LinkSourceFormValues,
} from '@/lib/validations/link-sources';
import { ApiError } from '@/providers/auth-provider';

interface EditLinkSourceDialogProps {
  workspaceId: string;
  source: LinkSourceWithStatsDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (source: LinkSourceDto) => void;
}

export function EditLinkSourceDialog({
  workspaceId,
  source,
  open,
  onOpenChange,
  onUpdated,
}: EditLinkSourceDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isActive, setIsActive] = React.useState(source.isActive);

  const form = useForm<LinkSourceFormValues>({
    resolver: zodResolver(linkSourceSchema),
    defaultValues: {
      name: source.name,
      source: source.source,
      medium: source.medium,
      campaign: source.campaign ?? '',
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setIsActive(source.isActive);
    }
    onOpenChange(next);
  }

  async function onSubmit(values: LinkSourceFormValues) {
    setIsSubmitting(true);
    try {
      const updated = await updateLinkSource(workspaceId, source.id, {
        name: values.name,
        source: values.source,
        medium: values.medium,
        campaign: values.campaign || undefined,
        isActive,
      });
      toast.success('Tracking source updated');
      onUpdated(updated);
      handleOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to update tracking source',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit tracking source</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="WhatsApp Campaign" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source</FormLabel>
                    <FormControl>
                      <Input placeholder="whatsapp" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="medium"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Medium</FormLabel>
                    <FormControl>
                      <Input placeholder="messaging" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="campaign"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="summer_sale" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">
                  {isActive ? 'Active' : 'Deactivated'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isActive
                    ? 'New clicks through this URL are attributed to this source.'
                    : 'New clicks no longer attribute to this source (existing history is unaffected).'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsActive((prev) => !prev)}
              >
                {isActive ? 'Deactivate' : 'Activate'}
              </Button>
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
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
