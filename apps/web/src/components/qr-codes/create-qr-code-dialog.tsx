'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { LinkDto, QrCodeDto } from '@linkiq/types';
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

import { listLinks } from '@/lib/links-api';
import { createQrCode } from '@/lib/qr-codes-api';
import {
  qrConfigSchema,
  type QrConfigFormValues,
} from '@/lib/validations/qr-codes';
import { ApiError } from '@/providers/auth-provider';

import { QrPreview } from './qr-preview';

interface CreateQrCodeDialogProps {
  workspaceId: string;
  /** When provided (e.g. opened from a link's detail page), the link
   * picker is skipped entirely — a QR code can never be created without
   * one, so there's nothing to "leave blank" here. */
  link?: Pick<LinkDto, 'id' | 'shortCode' | 'title'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (qrCode: QrCodeDto) => void;
}

export function CreateQrCodeDialog({
  workspaceId,
  link,
  open,
  onOpenChange,
  onCreated,
}: CreateQrCodeDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedLink, setSelectedLink] = React.useState<Pick<
    LinkDto,
    'id' | 'shortCode' | 'title'
  > | null>(link ?? null);
  const [availableLinks, setAvailableLinks] = React.useState<LinkDto[]>([]);
  const [loadingLinks, setLoadingLinks] = React.useState(false);

  const form = useForm<QrConfigFormValues>({
    resolver: zodResolver(qrConfigSchema),
    defaultValues: {
      name: '',
      format: 'PNG',
      size: 512,
      foregroundColor: '#000000',
      backgroundColor: '#FFFFFF',
      errorCorrectionLevel: 'M',
      margin: 4,
    },
  });

  React.useEffect(() => {
    if (!open) return;
    setSelectedLink(link ?? null);
    form.reset();
    if (!link) {
      setLoadingLinks(true);
      listLinks(workspaceId, { pageSize: 100, status: 'ACTIVE' })
        .then((res) => setAvailableLinks(res.items))
        .catch(() => toast.error('Failed to load links'))
        .finally(() => setLoadingLinks(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, link]);

  const watched = form.watch();
  const previewData = React.useMemo(() => {
    if (!selectedLink) return null;
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'https://linkiq.example';
    const campaign = (watched.name || 'qr-code')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    return `${origin}/${selectedLink.shortCode}?utm_source=qr_code&utm_medium=qr&utm_campaign=${campaign}`;
  }, [selectedLink, watched.name]);

  function handleOpenChange(next: boolean) {
    if (!next) form.reset();
    onOpenChange(next);
  }

  async function onSubmit(values: QrConfigFormValues) {
    if (!selectedLink) {
      toast.error('Select a link first');
      return;
    }
    setIsSubmitting(true);
    try {
      const qrCode = await createQrCode(workspaceId, selectedLink.id, values);
      toast.success('QR code created');
      onCreated(qrCode);
      handleOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to create QR code',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a QR code</DialogTitle>
        </DialogHeader>

        {!link && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Link</label>
            {loadingLinks ? (
              <p className="text-sm text-muted-foreground">Loading links…</p>
            ) : (
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={selectedLink?.id ?? ''}
                onChange={(e) => {
                  const found = availableLinks.find(
                    (l) => l.id === e.target.value,
                  );
                  setSelectedLink(found ?? null);
                }}
              >
                <option value="" disabled>
                  Select a link…
                </option>
                {availableLinks.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title ?? l.shortCode} ({l.shortCode})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Storefront Poster" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="format"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Format</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        {...field}
                      >
                        <option value="PNG">PNG</option>
                        <option value="SVG">SVG</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="foregroundColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Foreground</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="h-9 w-9 rounded border"
                            {...field}
                          />
                          <Input {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="backgroundColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Background</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="h-9 w-9 rounded border"
                            {...field}
                          />
                          <Input {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="size"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Size (px)</FormLabel>
                      <FormControl>
                        <Input type="number" min={128} max={1024} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="margin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Margin</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={20} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="errorCorrectionLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Error correction</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        {...field}
                      >
                        <option value="L">Low (L)</option>
                        <option value="M">Medium (M)</option>
                        <option value="Q">Quartile (Q)</option>
                        <option value="H">High (H)</option>
                      </select>
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
                <Button type="submit" disabled={isSubmitting || !selectedLink}>
                  {isSubmitting ? 'Creating…' : 'Create QR code'}
                </Button>
              </DialogFooter>
            </form>
          </Form>

          <div className="flex flex-col items-center justify-center">
            {previewData ? (
              <QrPreview
                config={{
                  data: previewData,
                  size: watched.size || 512,
                  foregroundColor: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(
                    watched.foregroundColor || '',
                  )
                    ? watched.foregroundColor
                    : '#000000',
                  backgroundColor: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(
                    watched.backgroundColor || '',
                  )
                    ? watched.backgroundColor
                    : '#FFFFFF',
                  errorCorrectionLevel: watched.errorCorrectionLevel || 'M',
                  margin: watched.margin ?? 4,
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a link to preview
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
