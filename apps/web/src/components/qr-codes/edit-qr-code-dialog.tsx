'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { QrCodeDto } from '@linkiq/types';
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

import { updateQrCode } from '@/lib/qr-codes-api';
import {
  qrConfigSchema,
  type QrConfigFormValues,
} from '@/lib/validations/qr-codes';
import { ApiError } from '@/providers/auth-provider';

import { QrPreview } from './qr-preview';

interface EditQrCodeDialogProps {
  workspaceId: string;
  qrCode: QrCodeDto;
  shortCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (qrCode: QrCodeDto) => void;
}

export function EditQrCodeDialog({
  workspaceId,
  qrCode,
  shortCode,
  open,
  onOpenChange,
  onUpdated,
}: EditQrCodeDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<QrConfigFormValues>({
    resolver: zodResolver(qrConfigSchema),
    defaultValues: {
      name: qrCode.name,
      format: qrCode.format,
      size: qrCode.size,
      foregroundColor: qrCode.foregroundColor,
      backgroundColor: qrCode.backgroundColor,
      errorCorrectionLevel: qrCode.errorCorrectionLevel,
      margin: qrCode.margin,
    },
  });

  const watched = form.watch();
  const previewData = React.useMemo(() => {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'https://linkiq.example';
    const campaign = (watched.name || 'qr-code')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    return `${origin}/${shortCode}?utm_source=qr_code&utm_medium=qr&utm_campaign=${campaign}`;
  }, [shortCode, watched.name]);

  async function onSubmit(values: QrConfigFormValues) {
    setIsSubmitting(true);
    try {
      const updated = await updateQrCode(workspaceId, qrCode.id, values);
      toast.success('QR code updated');
      onUpdated(updated);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to update QR code',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit QR code</DialogTitle>
        </DialogHeader>

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
                      <Input {...field} />
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

          <div className="flex flex-col items-center justify-center">
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
