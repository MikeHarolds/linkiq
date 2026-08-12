'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CampaignDto, DomainDto, LinkDto } from '@linkiq/types';
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
import { ChevronDown, ChevronUp, Check, Copy } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { UtmFields } from '@/components/campaigns/utm-fields';
import { listCampaigns } from '@/lib/campaigns-api';
import { listDomains } from '@/lib/domains-api';
import { createLink } from '@/lib/links-api';
import {
  createLinkSchema,
  type CreateLinkFormValues,
} from '@/lib/validations/links';
import { previewUtmUrl } from '@/lib/validations/utm';
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
  const [showTracking, setShowTracking] = React.useState(false);
  const [campaigns, setCampaigns] = React.useState<CampaignDto[]>([]);
  const [domains, setDomains] = React.useState<DomainDto[]>([]);

  const form = useForm<CreateLinkFormValues>({
    resolver: zodResolver(createLinkSchema),
    defaultValues: {
      destinationUrl: '',
      slug: '',
      title: '',
      description: '',
      expiresAt: '',
      campaignId: '',
      customDomainId: '',
      utmSource: '',
      utmMedium: '',
      utmCampaign: '',
      utmTerm: '',
      utmContent: '',
    },
  });

  React.useEffect(() => {
    if (!open) return;
    listCampaigns(workspaceId, { pageSize: 100 })
      .then((res) => setCampaigns(res.items))
      .catch(() => {
        /* campaign selection is optional — a failed fetch just means an
         * empty picker, not a broken dialog */
      });
    // Only ACTIVE domains actually serve redirects (see
    // DomainResolverService) — a VERIFIED-but-not-yet-activated domain
    // would be selectable on the backend but silently 404 for visitors,
    // so the picker only offers what will actually work right now.
    listDomains(workspaceId, { status: 'ACTIVE', pageSize: 100 })
      .then((res) => setDomains(res.items))
      .catch(() => {
        /* domain selection is optional — same reasoning as campaigns above */
      });
  }, [open, workspaceId]);

  const selectedCampaignId = form.watch('campaignId');
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);
  const watchedUtm = form.watch([
    'utmSource',
    'utmMedium',
    'utmCampaign',
    'utmTerm',
    'utmContent',
  ]);
  const watchedDestination = form.watch('destinationUrl');

  const previewUrl = React.useMemo(() => {
    if (!watchedDestination) return null;
    const [utmSource, utmMedium, utmCampaign, utmTerm, utmContent] = watchedUtm;
    return previewUtmUrl(watchedDestination, {
      utmSource: utmSource || selectedCampaign?.utmSource || undefined,
      utmMedium: utmMedium || selectedCampaign?.utmMedium || undefined,
      utmCampaign: utmCampaign || selectedCampaign?.utmCampaign || undefined,
      utmTerm: utmTerm || selectedCampaign?.utmTerm || undefined,
      utmContent: utmContent || selectedCampaign?.utmContent || undefined,
    });
  }, [watchedDestination, watchedUtm, selectedCampaign]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setCreatedLink(null);
      setCopied(false);
      setShowTracking(false);
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
        campaignId: values.campaignId || undefined,
        customDomainId: values.customDomainId || undefined,
        utmSource: values.utmSource || undefined,
        utmMedium: values.utmMedium || undefined,
        utmCampaign: values.utmCampaign || undefined,
        utmTerm: values.utmTerm || undefined,
        utmContent: values.utmContent || undefined,
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
    await navigator.clipboard.writeText(
      createdLink.publicUrl ?? `${APP_URL}/${createdLink.shortCode}`,
    );
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
                  {createdLink.publicUrl ??
                    `${APP_URL}/${createdLink.shortCode}`}
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
                {domains.length > 0 && (
                  <FormField
                    control={form.control}
                    name="customDomainId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Domain (optional)</FormLabel>
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

                {/* Progressive disclosure: a user who just wants a plain
                    link never has to see this — Sprint 5's own spec
                    requirement ("a user who does not want campaign
                    tracking should still be able to create a normal link
                    exactly as before"). */}
                <button
                  type="button"
                  onClick={() => setShowTracking((v) => !v)}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                >
                  <span>Campaign &amp; UTM tracking (optional)</span>
                  {showTracking ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                {showTracking && (
                  <div className="space-y-4 rounded-md border p-3">
                    <FormField
                      control={form.control}
                      name="campaignId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Campaign (optional)</FormLabel>
                          <FormControl>
                            <select
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                              {...field}
                            >
                              <option value="">No campaign</option>
                              {campaigns.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <UtmFields
                      control={form.control}
                      inheritedDefaults={
                        selectedCampaign
                          ? {
                              utmSource: selectedCampaign.utmSource,
                              utmMedium: selectedCampaign.utmMedium,
                              utmCampaign: selectedCampaign.utmCampaign,
                              utmTerm: selectedCampaign.utmTerm,
                              utmContent: selectedCampaign.utmContent,
                            }
                          : undefined
                      }
                    />

                    {previewUrl && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          Final destination preview
                        </p>
                        <p className="break-all rounded-md bg-muted/40 px-3 py-2 text-xs">
                          {previewUrl}
                        </p>
                      </div>
                    )}
                  </div>
                )}

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
