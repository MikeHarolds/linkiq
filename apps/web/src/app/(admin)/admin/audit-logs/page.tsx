'use client';

import {
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { PaginationFooter } from '@/components/admin/pagination-footer';
import { listAuditLogs } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PAGE_SIZE = 30;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export default function AdminAuditLogsPage() {
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'audit-logs', page, debouncedSearch],
    queryFn: () => listAuditLogs({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined }),
  });

  return (
    <div>
      <AdminPageHeader
        title="Audit Logs"
        description="Every recorded action across the platform, including Super Admin actions themselves."
      />

      <div className="mb-4">
        <Input
          aria-label="Search audit logs"
          placeholder="Search by action, entity, or entity ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
      </div>

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading audit logs…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load audit logs.'}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No audit entries match this search.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Workspace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      {entry.user ? `${entry.user.firstName} ${entry.user.lastName}` : 'System'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.entity}
                      {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.workspace ? entry.workspace.name : '—'}
                    </TableCell>
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
