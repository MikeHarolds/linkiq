'use client';

import type { QrCodeDto } from '@linkiq/types';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@linkiq/ui';
import { Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import {
  deleteQrCode,
  downloadQrCode,
  getQrPreviewObjectUrl,
} from '@/lib/qr-codes-api';
import { ApiError } from '@/providers/auth-provider';

interface QrCodeCardProps {
  workspaceId: string;
  qrCode: QrCodeDto;
  linkLabel?: string;
  canManage: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export function QrCodeCard({
  workspaceId,
  qrCode,
  linkLabel,
  canManage,
  onEdit,
  onDeleted,
}: QrCodeCardProps) {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = React.useState(false);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    getQrPreviewObjectUrl(workspaceId, qrCode.id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch(() => setPreviewFailed(true));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspaceId, qrCode.id]);

  async function handleDownload(format?: 'PNG' | 'SVG') {
    try {
      const { blob, filename } = await downloadQrCode(
        workspaceId,
        qrCode.id,
        format,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Download failed',
      );
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${qrCode.name}"? This cannot be undone.`))
      return;
    try {
      await deleteQrCode(workspaceId, qrCode.id);
      toast.success('QR code deleted');
      onDeleted();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to delete QR code',
      );
    }
  }

  return (
    <div className="flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary/30">
      <div
        className="flex items-center justify-center rounded-md bg-muted/40 p-3"
        style={{ minHeight: 160 }}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={`QR code for ${qrCode.name}`}
            className="h-32 w-32 object-contain"
          />
        ) : previewFailed ? (
          <p className="text-xs text-muted-foreground">Preview unavailable</p>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </div>

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{qrCode.name}</p>
          {linkLabel && (
            <p className="truncate text-xs text-muted-foreground">
              {linkLabel}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline">{qrCode.format}</Badge>
            <span className="text-xs text-muted-foreground">
              {formatDate(qrCode.createdAt)}
            </span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="QR code actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleDownload('PNG')}>
              <Download className="mr-2 h-4 w-4" />
              Download PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload('SVG')}>
              <Download className="mr-2 h-4 w-4" />
              Download SVG
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
