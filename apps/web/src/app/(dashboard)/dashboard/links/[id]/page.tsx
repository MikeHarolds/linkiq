'use client';

import type { QrCodeDto } from '@linkiq/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Check, Copy, ExternalLink, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';

import { CreateQrCodeDialog } from '@/components/qr-codes/create-qr-code-dialog';
import { EditQrCodeDialog } from '@/components/qr-codes/edit-qr-code-dialog';
import { QrCodeCard } from '@/components/qr-codes/qr-code-card';
import { getLink } from '@/lib/links-api';
import { listQrCodesForLink } from '@/lib/qr-codes-api';
import { useAuth } from '@/providers/auth-provider';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function statusBadgeVariant(
  status: string,
): 'success' | 'secondary' | 'outline' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PAUSED') return 'secondary';
  return 'outline';
}

export default function LinkDetailPage() {
  const params = useParams<{ id: string }>();
  const linkId = params.id;
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  const canManage =
    currentRole === 'OWNER' ||
    currentRole === 'ADMIN' ||
    currentRole === 'MEMBER';

  const [copied, setCopied] = React.useState(false);
  const [createQrOpen, setCreateQrOpen] = React.useState(false);
  const [editingQr, setEditingQr] = React.useState<QrCodeDto | null>(null);

  const link = useQuery({
    queryKey: ['links', currentWorkspaceId, linkId],
    queryFn: () => getLink(currentWorkspaceId!, linkId),
    enabled: Boolean(currentWorkspaceId),
  });

  const qrCodes = useQuery({
    queryKey: ['qr-codes', 'for-link', currentWorkspaceId, linkId],
    queryFn: () => listQrCodesForLink(currentWorkspaceId!, linkId),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidateQrCodes() {
    queryClient.invalidateQueries({
      queryKey: ['qr-codes', 'for-link', currentWorkspaceId, linkId],
    });
  }

  async function handleCopy() {
    if (!link.data) return;
    await navigator.clipboard.writeText(`${APP_URL}/${link.data.shortCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view this link.
      </p>
    );
  }

  if (link.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        Loading link…
      </div>
    );
  }

  if (link.isError || !link.data) {
    return (
      <div role="alert" className="text-sm text-destructive">
        Failed to load this link.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {link.data.title ?? link.data.shortCode}
            </h1>
            <Badge variant={statusBadgeVariant(link.data.status)}>
              {link.data.status}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <code className="text-sm font-medium">
              {APP_URL}/{link.data.shortCode}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
              aria-label="Copy short URL"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <a
            href={link.data.destinationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {link.data.destinationUrl}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/dashboard/links/${linkId}/analytics`}>
            <BarChart3 className="mr-2 h-4 w-4" />
            View analytics
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>QR Codes</CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => setCreateQrOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create QR code
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {qrCodes.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading QR codes…</p>
          ) : qrCodes.isError ? (
            <p className="text-sm text-destructive">Failed to load QR codes.</p>
          ) : !qrCodes.data || qrCodes.data.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No QR codes for this link yet.
              </p>
              {canManage && (
                <Button
                  className="mt-4"
                  size="sm"
                  onClick={() => setCreateQrOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create one
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {qrCodes.data.map((qrCode) => (
                <QrCodeCard
                  key={qrCode.id}
                  workspaceId={currentWorkspaceId}
                  qrCode={qrCode}
                  canManage={canManage}
                  onEdit={() => setEditingQr(qrCode)}
                  onDeleted={invalidateQrCodes}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateQrCodeDialog
        workspaceId={currentWorkspaceId}
        link={{
          id: link.data.id,
          shortCode: link.data.shortCode,
          title: link.data.title,
        }}
        open={createQrOpen}
        onOpenChange={setCreateQrOpen}
        onCreated={() => invalidateQrCodes()}
      />
      {editingQr && (
        <EditQrCodeDialog
          workspaceId={currentWorkspaceId}
          qrCode={editingQr}
          shortCode={link.data.shortCode}
          open={Boolean(editingQr)}
          onOpenChange={(open) => !open && setEditingQr(null)}
          onUpdated={() => {
            invalidateQrCodes();
            setEditingQr(null);
          }}
        />
      )}
    </div>
  );
}
