'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { LinkDto } from '@linkiq/types';
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
import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { createLink } from '@/lib/links-api';
import {
  createLinkSchema,
  type CreateLinkFormValues,
} from '@/lib/validations/links';
import { ApiError } from '@/providers/auth-provider';

interface CreateLinkDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (link: LinkDto) => void;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export function CreateLinkDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: CreateLinkDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [createdLink, setCreatedLink] = React.useState<LinkDto | null>(null);
  const [copied, setCopied] = React.useState(false);

  const form = useForm<CreateLinkFormValues>({
    resolver: zodResolver(createLinkSchema),
    defaultValues: {
      destinationUrl: '',
      slug: '',
      title: '',
      description: '',
      expiresAt: '',
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setCreatedLink(null);
      setCopied(false);
    }
    onOpenChange(next);
  }

  async function onSubmit(values: CreateLinkFormValues) {
    setIsSubmitting(true);
    try {
      const link = await createLink(workspaceId, {
        destinationUrl: values.destinationUrl,
        slug: values.slug || undefined,
        title: values.title || undefined,
        description: values.description || undefined,
        expiresAt: values.expiresAt
          ? new Date(values.expiresAt).toISOString()
          : undefined,
      });
      setCreatedLink(link);
      onCreated(link);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to create link',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyShortUrl() {
    if (!createdLink) return;
    await navigator.clipboard.writeText(`${APP_URL}/${createdLink.shortCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {createdLink ? (
          <>
            <DialogHeader>
              <DialogTitle>Link created</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your short link is ready to share.
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-sm font-medium">
                  {APP_URL}/{createdLink.shortCode}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={copyShortUrl}
                  aria-label="Copy short URL"
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
              <DialogTitle>Create a short link</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="destinationUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination URL</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://example.com/your-page"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Custom slug (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="my-campaign" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title (optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Summer Sale Landing Page"
                          {...field}
                        />
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
                      <FormLabel>Description (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="What this link is for"
                          {...field}
                        />
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
                      <FormLabel>Expiration date (optional)</FormLabel>
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
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating…' : 'Create link'}
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
