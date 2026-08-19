'use client';

import type { AdminInvoiceDto, InvoiceStatus } from '@linkiq/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { PaginationFooter } from '@/components/admin/pagination-footer';
import { StatusBadge } from '@/components/admin/status-badge';
import { listInvoices } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: InvoiceStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Uncollectible', value: 'UNCOLLECTIBLE' },
  { label: 'Refunded', value: 'REFUNDED' },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function formatMoney(amount: number, currency: string): string {
  return (amount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency,
  });
}

function InvoiceDetailDialog({
  invoice,
  onClose,
}: {
  invoice: AdminInvoiceDto;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invoice {invoice.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Workspace</span>
            <span>{invoice.workspace.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Plan</span>
            <span>{invoice.targetPlan?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span>{formatMoney(invoice.amount, invoice.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Currency</span>
            <span>{invoice.currency}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <StatusBadge status={invoice.status} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Provider</span>
            <span>{invoice.provider ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Provider reference</span>
            <span className="font-mono text-xs">
              {invoice.providerInvoiceId ?? '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Issued</span>
            <span>{formatDate(invoice.issueDate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid</span>
            <span>{formatDate(invoice.paidAt)}</span>
          </div>
          {invoice.failureReason && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Failure reason</span>
              <span>{invoice.failureReason}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminInvoicesPage() {
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState<InvoiceStatus | undefined>(
    undefined,
  );
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<AdminInvoiceDto | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'invoices', page, debouncedSearch, status],
    queryFn: () =>
      listInvoices({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        status,
      }),
  });

  return (
    <div>
      <AdminPageHeader
        title="Invoices"
        description="Platform-wide invoice register."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search invoices"
          placeholder="Search by invoice number or reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={status === filter.value ? 'default' : 'outline'}
            onClick={() => {
              setStatus(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-muted-foreground"
        >
          Loading invoices…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load invoices.'}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No invoices match this filter.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">
                      {invoice.number}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/workspaces/${invoice.workspaceId}`}
                        className="hover:underline"
                      >
                        {invoice.workspace.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invoice.targetPlan?.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      {formatMoney(invoice.amount, invoice.currency)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invoice.paidAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(invoice)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationFooter
            pagination={data.pagination}
            onPageChange={setPage}
          />
        </>
      )}

      {selected && (
        <InvoiceDetailDialog
          invoice={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
