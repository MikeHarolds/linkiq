'use client';

import {
  Badge,
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
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import { getWorkspace } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export default function AdminWorkspaceDetailPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const { data: ws, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'workspaces', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
  });

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  if (isError || !ws) {
    return (
      <div role="alert" className="py-12 text-center text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load workspace.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title={ws.name} description={`${ws.organizationName} · ${ws.slug}`} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workspace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Owner</span>
              <Link href={`/admin/users/${ws.owner.id}`} className="hover:underline">
                {ws.owner.firstName} {ws.owner.lastName}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Members</span>
              <span>{ws.memberCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Links</span>
              <span>{ws.linkCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Domains</span>
              <span>{ws.domainCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(ws.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span>{ws.planName ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              {ws.subscriptionStatus ? <StatusBadge status={ws.subscriptionStatus} /> : <span>—</span>}
            </div>
            <Link
              href={`/admin/subscriptions?search=${encodeURIComponent(ws.slug)}`}
              className="inline-block pt-1 text-xs text-primary hover:underline"
            >
              Manage subscription →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {ws.usage.map((u) => (
              <div key={u.key} className="flex justify-between">
                <span className="text-muted-foreground">{u.key.replaceAll('_', ' ')}</span>
                <span>
                  {u.usage}
                  {u.unlimited ? ' / ∞' : u.limit !== null ? ` / ${u.limit}` : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({ws.members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ws.members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link href={`/admin/users/${m.user.id}`} className="hover:underline">
                        {m.user.firstName} {m.user.lastName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{m.user.email}</div>
                    </TableCell>
                    <TableCell>{m.role}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Domains ({ws.domains.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {ws.domains.length === 0 ? (
              <p className="text-sm text-muted-foreground">No custom domains.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {ws.domains.map((d) => (
                  <li key={d.id} className="flex items-center justify-between">
                    <span>
                      {d.domain}
                      {d.isPrimary && (
                        <Badge variant="secondary" className="ml-2">
                          Primary
                        </Badge>
                      )}
                    </span>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">API keys ({ws.apiKeys.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {ws.apiKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No API keys.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {ws.apiKeys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between">
                    <span>
                      {k.name} <span className="font-mono text-xs text-muted-foreground">{k.keyPrefix}</span>
                    </span>
                    <StatusBadge status={k.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook endpoints ({ws.webhookEndpoints.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {ws.webhookEndpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No webhook endpoints.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {ws.webhookEndpoints.map((e) => (
                <li key={e.id} className="flex items-center justify-between">
                  <span>
                    {e.name} <span className="text-xs text-muted-foreground">{e.url}</span>
                  </span>
                  <StatusBadge status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent audit activity</CardTitle>
        </CardHeader>
        <CardContent>
          {ws.recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded activity.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ws.recentAudit.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.user ? `${entry.user.firstName} ${entry.user.lastName}` : 'System'}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(entry.createdAt)}</TableCell>
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
