'use client';

import type { QrCodeDto } from '@linkiq/types';
import { Button, Input } from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import * as React from 'react';

import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import { CreateQrCodeDialog } from '@/components/qr-codes/create-qr-code-dialog';
import { EditQrCodeDialog } from '@/components/qr-codes/edit-qr-code-dialog';
import { QrCodeCard } from '@/components/qr-codes/qr-code-card';
import { listQrCodes } from '@/lib/qr-codes-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

const PAGE_SIZE = 12;

export default function QrCodesDashboardPage() {
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  const canManage =
    currentRole === 'OWNER' ||
    currentRole === 'ADMIN' ||
    currentRole === 'MEMBER';

  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingQr, setEditingQr] = React.useState<QrCodeDto | null>(null);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const queryKey = ['qr-codes', currentWorkspaceId, page, debouncedSearch];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      listQrCodes(currentWorkspaceId!, {
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
      }),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ['qr-codes', currentWorkspaceId],
    });
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view QR codes.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="QR Codes"
        description="Generate and manage QR codes for your links."
        actions={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create QR code
            </Button>
          )
        }
      />

      <Input
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="sm:max-w-sm"
        aria-label="Search QR codes"
      />

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-muted-foreground"
        >
          Loading QR codes…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load QR codes.'}
        </div>
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">
            {debouncedSearch
              ? 'No QR codes match your search.'
              : "You haven't created any QR codes yet."}
          </p>
          {canManage && !debouncedSearch && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first QR code
            </Button>
          )}
        </div>
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((qrCode) => (
              <QrCodeCard
                key={qrCode.id}
                workspaceId={currentWorkspaceId}
                qrCode={qrCode}
                linkLabel={
                  qrCode.link
                    ? (qrCode.link.title ?? qrCode.link.shortCode)
                    : undefined
                }
                canManage={canManage}
                onEdit={() => setEditingQr(qrCode)}
                onDeleted={invalidate}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {data.pagination.page} of {data.pagination.totalPages} ·{' '}
              {data.pagination.totalItems} QR code
              {data.pagination.totalItems === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <CreateQrCodeDialog
        workspaceId={currentWorkspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => invalidate()}
      />
      {editingQr && editingQr.link && (
        <EditQrCodeDialog
          workspaceId={currentWorkspaceId}
          qrCode={editingQr}
          shortCode={editingQr.link.shortCode}
          open={Boolean(editingQr)}
          onOpenChange={(open) => !open && setEditingQr(null)}
          onUpdated={() => {
            invalidate();
            setEditingQr(null);
          }}
        />
      )}
    </div>
  );
}
