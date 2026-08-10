'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CampaignDto } from '@linkiq/types';
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

import { updateCampaign } from '@/lib/campaigns-api';
import {
  campaignFormSchema,
  type CampaignFormValues,
} from '@/lib/validations/campaigns';
import { ApiError } from '@/providers/auth-provider';

import { UtmFields } from './utm-fields';

interface EditCampaignDialogProps {
  workspaceId: string;
  campaign: CampaignDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (campaign: CampaignDto) => void;
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function EditCampaignDialog({
  workspaceId,
  campaign,
  open,
  onOpenChange,
  onUpdated,
}: EditCampaignDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: {
      name: campaign.name,
      description: campaign.description ?? '',
      startDate: toDateInput(campaign.startDate),
      endDate: toDateInput(campaign.endDate),
      utmSource: campaign.utmSource ?? '',
      utmMedium: campaign.utmMedium ?? '',
      utmCampaign: campaign.utmCampaign ?? '',
      utmTerm: campaign.utmTerm ?? '',
      utmContent: campaign.utmContent ?? '',
    },
  });

  async function onSubmit(values: CampaignFormValues) {
    setIsSubmitting(true);
    try {
      const updated = await updateCampaign(workspaceId, campaign.id, {
        name: values.name,
        description: values.description || undefined,
        startDate: values.startDate
          ? new Date(values.startDate).toISOString()
          : undefined,
        endDate: values.endDate
          ? new Date(values.endDate).toISOString()
          : undefined,
        utmSource: values.utmSource || undefined,
        utmMedium: values.utmMedium || undefined,
        utmCampaign: values.utmCampaign || undefined,
        utmTerm: values.utmTerm || undefined,
        utmContent: values.utmContent || undefined,
      });
      toast.success('Campaign updated');
      onUpdated(updated);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to update campaign',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
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
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Default UTM parameters</p>
              <UtmFields control={form.control} />
            </div>

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
