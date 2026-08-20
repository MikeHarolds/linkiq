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
import {
  CUSTOM_TRACKING_SOURCE_KEY,
  PREDEFINED_TRACKING_SOURCES,
  findPredefinedTrackingSource,
} from '@linkiq/utils';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  createLinkSource,
  type LinkSourceWithStatsDto,
} from '@/lib/link-sources-api';
import {
  linkSourceSchema,
  type LinkSourceFormValues,
} from '@/lib/validations/link-sources';
import { ApiError } from '@/providers/auth-provider';

interface CreateLinkSourceDialogProps {
  workspaceId: string;
  linkId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: LinkSourceWithStatsDto) => void;
}

/** "Custom" is a UI-only concept (Phase 3/4): it's not one of
 * PREDEFINED_TRACKING_SOURCES, it just switches the Source select into
 * a free-text key input instead. */
const SELECT_OPTIONS = [
  ...PREDEFINED_TRACKING_SOURCES,
  { key: CUSTOM_TRACKING_SOURCE_KEY, label: 'Custom', defaultMedium: '' },
];

// PREDEFINED_TRACKING_SOURCES is a known-non-empty literal array (see
// packages/utils/src/tracking-sources.ts) — hoisted once here so
// TypeScript's noUncheckedIndexedAccess only needs asserting once.
const DEFAULT_SOURCE = PREDEFINED_TRACKING_SOURCES[0]!;

export function CreateLinkSourceDialog({
  workspaceId,
  linkId,
  open,
  onOpenChange,
  onCreated,
}: CreateLinkSourceDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedKey, setSelectedKey] = React.useState<string>(
    DEFAULT_SOURCE.key,
  );
  const isCustom = selectedKey === CUSTOM_TRACKING_SOURCE_KEY;

  const form = useForm<LinkSourceFormValues>({
    resolver: zodResolver(linkSourceSchema),
    defaultValues: {
      name: DEFAULT_SOURCE.label,
      source: DEFAULT_SOURCE.key,
      medium: DEFAULT_SOURCE.defaultMedium,
      campaign: '',
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setSelectedKey(DEFAULT_SOURCE.key);
    }
    onOpenChange(next);
  }

  function handleSelectSource(key: string) {
    setSelectedKey(key);
    if (key === CUSTOM_TRACKING_SOURCE_KEY) {
      form.setValue('source', '');
      form.setValue('name', '');
      form.setValue('medium', '');
      return;
    }
    const predefined = findPredefinedTrackingSource(key);
    if (predefined) {
      form.setValue('source', predefined.key);
      form.setValue('name', predefined.label);
      form.setValue('medium', predefined.defaultMedium);
    }
  }

  async function onSubmit(values: LinkSourceFormValues) {
    setIsSubmitting(true);
    try {
      const source = await createLinkSource(workspaceId, linkId, {
        name: values.name,
        source: values.source,
        medium: values.medium,
        campaign: values.campaign || undefined,
      });
      toast.success('Tracking source created');
      onCreated(source);
      handleOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to create tracking source',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Track this link</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Source</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={selectedKey}
                onChange={(e) => handleSelectSource(e.target.value)}
              >
                {SELECT_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {isCustom && (
              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custom source key</FormLabel>
                    <FormControl>
                      <Input placeholder="partner_x" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
                {isSubmitting ? 'Creating…' : 'Create tracking variant'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
