'use client';

import {
  Badge,
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
import { listUsers } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'true' as const },
  { label: 'Suspended', value: 'false' as const },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export default function AdminUsersPage() {
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [isActive, setIsActive] = React.useState<'true' | 'false' | undefined>(undefined);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'users', page, debouncedSearch, isActive],
    queryFn: () => listUsers({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined, isActive }),
  });

  return (
    <div>
      <AdminPageHeader title="Users" description="Every account on the LinkIQ platform." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search users"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={isActive === filter.value ? 'default' : 'outline'}
            onClick={() => {
              setIsActive(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading users…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load users.'}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No users match this filter.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="font-medium hover:underline"
                      >
                        {user.firstName} {user.lastName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      {user.globalRole === 'SUPER_ADMIN' ? (
                        <Badge variant="warning">Super Admin</Badge>
                      ) : (
                        <span className="text-muted-foreground">User</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? 'success' : 'destructive'}>
                        {user.isActive ? 'Active' : 'Suspended'}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.workspaceCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(user.lastLoginAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(user.createdAt)}
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
