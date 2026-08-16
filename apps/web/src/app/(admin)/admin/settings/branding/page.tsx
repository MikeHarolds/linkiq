'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Trash2, Upload } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  getBranding,
  removeFavicon,
  removeLogo,
  updateBranding,
  uploadFavicon,
  uploadLogo,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const MAX_LOGO_MB = 2;
const MAX_FAVICON_KB = 512;

function UploadSlot({
  label,
  description,
  imageUrl,
  maxSizeLabel,
  onUpload,
  onRemove,
  busy,
}: {
  label: string;
  description: string;
  imageUrl: string | null;
  maxSizeLabel: string;
  onUpload: (file: File) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={`${label} preview`} className="h-full w-full object-contain p-2" />
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          PNG, JPEG, WEBP, SVG, or ICO — max {maxSizeLabel}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,.ico"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          {imageUrl ? 'Replace' : 'Upload'}
        </Button>
        {imageUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmRemoveOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemoveOpen}
        onOpenChange={setConfirmRemoveOpen}
        title={`Remove ${label.toLowerCase()}?`}
        description="The site will fall back to the default LinkIQ mark immediately."
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={() => {
          onRemove();
          setConfirmRemoveOpen(false);
        }}
      />
    </div>
  );
}

export default function BrandingSettingsPage() {
  const queryClient = useQueryClient();
  const [siteName, setSiteName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'branding'],
    queryFn: getBranding,
  });

  React.useEffect(() => {
    if (data) setSiteName(data.siteName);
  }, [data]);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'branding'] });
  }

  async function handleSaveSiteName() {
    setBusy(true);
    try {
      await updateBranding(siteName);
      toast.success('Site name updated');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update site name');
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadLogo(file: File) {
    setBusy(true);
    try {
      await uploadLogo(file);
      toast.success('Logo updated');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to upload logo');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveLogo() {
    setBusy(true);
    try {
      await removeLogo();
      toast.success('Logo removed — using the default LinkIQ mark');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to remove logo');
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadFavicon(file: File) {
    setBusy(true);
    try {
      await uploadFavicon(file);
      toast.success('Favicon updated');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to upload favicon');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFavicon() {
    setBusy(true);
    try {
      await removeFavicon();
      toast.success('Favicon removed');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to remove favicon');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Site Branding"
        description="Controls the logo, favicon, and site name used across the public landing page, login, and registration."
      />

      {isLoading ? (
        <div role="status" aria-live="polite" className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Site name</CardTitle>
              <CardDescription>Shown in the header, footer, and browser tab title.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="siteName">Site name</Label>
                <Input
                  id="siteName"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  maxLength={60}
                />
              </div>
              <Button disabled={busy || siteName === data?.siteName || !siteName.trim()} onClick={handleSaveSiteName}>
                Save
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Logo</CardTitle>
              <CardDescription>
                Used on the public landing page, login, and registration. Falls back to the default LinkIQ mark
                when unset.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UploadSlot
                label="Logo"
                description="Displayed at a small size — a square or wide mark works best."
                imageUrl={data?.logoUrl ?? null}
                maxSizeLabel={`${MAX_LOGO_MB}MB`}
                onUpload={handleUploadLogo}
                onRemove={handleRemoveLogo}
                busy={busy}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Favicon</CardTitle>
              <CardDescription>The small icon shown in browser tabs.</CardDescription>
            </CardHeader>
            <CardContent>
              <UploadSlot
                label="Favicon"
                description="A square icon, ideally 32×32 or larger."
                imageUrl={data?.faviconUrl ?? null}
                maxSizeLabel={`${MAX_FAVICON_KB}KB`}
                onUpload={handleUploadFavicon}
                onRemove={handleRemoveFavicon}
                busy={busy}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
