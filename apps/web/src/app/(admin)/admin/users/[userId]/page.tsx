'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import {
  forceLogoutUser,
  getUser,
  getUserAuditActivity,
  reactivateUser,
  suspendUser,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function AdminUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const { data: user, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'users', userId],
    queryFn: () => getUser(userId),
  });

  const { data: activity } = useQuery({
    queryKey: ['admin', 'users', userId, 'activity'],
    queryFn: () => getUserAuditActivity(userId, 1, 20),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  }

  async function handleSuspend() {
    if (!window.confirm('Suspend this user? They will be signed out immediately and unable to log in.')) {
      return;
    }
    setBusy(true);
    try {
      await suspendUser(userId);
      toast.success('User suspended');
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to suspend user');
    } finally {
      setBusy(false);
    }
  }

  async function handleReactivate() {
    setBusy(true);
    try {
      await reactivateUser(userId);
      toast.success('User reactivated');
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reactivate user');
    } finally {
      setBusy(false);
    }
  }

  async function handleForceLogout() {
    if (!window.confirm('Revoke every active session for this user?')) return;
    setBusy(true);
    try {
      await forceLogoutUser(userId);
      toast.success('All sessions revoked');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to revoke sessions');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
        Loading user…
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div role="alert" className="py-12 text-center text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load user.'}
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title={`${user.firstName} ${user.lastName}`}
        description={user.email}
        actions={
          <>
            {user.isActive ? (
              <Button variant="destructive" size="sm" disabled={busy} onClick={handleSuspend}>
                Suspend
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={handleReactivate}>
                Reactivate
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={handleForceLogout}>
              Force logout
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={user.isActive ? 'success' : 'destructive'}>
                {user.isActive ? 'Active' : 'Suspended'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role</span>
              <span>{user.globalRole === 'SUPER_ADMIN' ? 'Super Admin' : 'User'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email verified</span>
              <span>{user.emailVerified ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last login</span>
              <span>{formatDateTime(user.lastLoginAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDateTime(user.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Workspaces ({user.workspaces.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {user.workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workspace memberships.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Subscription</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {user.workspaces.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell>
                          <Link href={`/admin/workspaces/${w.id}`} className="font-medium hover:underline">
                            {w.name}
                          </Link>
                        </TableCell>
                        <TableCell>{w.role}</TableCell>
                        <TableCell>{w.planName ?? '—'}</TableCell>
                        <TableCell>
                          {w.subscriptionStatus ? <StatusBadge status={w.subscriptionStatus} /> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {!activity || activity.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded activity.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activity.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                      <TableCell>{entry.entity}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
