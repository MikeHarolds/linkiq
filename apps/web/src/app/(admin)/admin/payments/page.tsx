'use client';

import type { InvoiceStatus } from '@linkiq/types';
import {
  Button,
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
import { listPayments } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: InvoiceStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Paid', value: 'PAID' },
  { label: 'Uncollectible', value: 'UNCOLLECTIBLE' },
  { label: 'Refunded', value: 'REFUNDED' },
  { label: 'Void', value: 'VOID' },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

function formatMoney(amount: number, currency: string): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency });
}

export default function AdminPaymentsPage() {
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState<InvoiceStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'payments', page, debouncedSearch, status],
    queryFn: () => listPayments({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined, status }),
  });

  return (
    <div>
      <AdminPageHeader
        title="Payments"
        description="Every payment transaction recorded on the platform."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search payments"
          placeholder="Search by reference or invoice number…"
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
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading payments…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load payments.'}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No payments match this filter.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Failure reason</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">
                      {invoice.providerInvoiceId ?? invoice.number}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/workspaces/${invoice.workspaceId}`}
                        className="hover:underline"
                      >
                        {invoice.workspace.name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatMoney(invoice.amount, invoice.currency)}</TableCell>
                    <TableCell className="text-muted-foreground">{invoice.provider ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{invoice.failureReason ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(invoice.issueDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationFooter pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
