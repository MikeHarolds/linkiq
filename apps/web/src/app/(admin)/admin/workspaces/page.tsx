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
import Link from 'next/link';
import * as React from 'react';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { PaginationFooter } from '@/components/admin/pagination-footer';
import { StatusBadge } from '@/components/admin/status-badge';
import { listWorkspaces } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PAGE_SIZE = 20;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export default function AdminWorkspacesPage() {
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
    queryKey: ['admin', 'workspaces', page, debouncedSearch],
    queryFn: () => listWorkspaces({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined }),
  });

  return (
    <div>
      <AdminPageHeader title="Workspaces" description="Every workspace on the LinkIQ platform." />

      <div className="mb-4">
        <Input
          aria-label="Search workspaces"
          placeholder="Search by name or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
      </div>

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading workspaces…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load workspaces.'}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No workspaces match this search.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Links</TableHead>
                  <TableHead>Domains</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((ws) => (
                  <TableRow key={ws.id}>
                    <TableCell>
                      <Link href={`/admin/workspaces/${ws.id}`} className="font-medium hover:underline">
                        {ws.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{ws.slug}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ws.owner.firstName} {ws.owner.lastName}
                    </TableCell>
                    <TableCell>{ws.planName ?? '—'}</TableCell>
                    <TableCell>
                      {ws.subscriptionStatus ? <StatusBadge status={ws.subscriptionStatus} /> : '—'}
                    </TableCell>
                    <TableCell>{ws.memberCount}</TableCell>
                    <TableCell>{ws.linkCount}</TableCell>
                    <TableCell>{ws.domainCount}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(ws.createdAt)}</TableCell>
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
