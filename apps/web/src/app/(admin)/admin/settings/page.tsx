'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { getPlatformSettings } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

export default function AdminSettingsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: getPlatformSettings,
  });

  return (
    <div>
      <AdminPageHeader
        title="Platform Settings"
        description="Read-only configuration status — every value here is read from the same server configuration every backend module already uses."
      />

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading settings…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load settings.'}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Billing</CardTitle>
              <CardDescription>
                <Link href="/admin/settings/payments" className="text-primary hover:underline">
                  View payment provider configuration →
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider</span>
                <span className="capitalize">{data.billingProvider}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhooks (outbound)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max delivery attempts</span>
                <span>{data.webhooks.maxAttempts}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Backoff base (ms)</span>
                <span>{data.webhooks.backoffBaseMs}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auto-disable threshold</span>
                <span>{data.webhooks.autoDisableThreshold}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Custom Domains</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Verification mode</span>
                <span className="capitalize">{data.domainVerificationMode}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Not yet configurable</CardTitle>
              <CardDescription>
                These require architectural work not yet built — listed here rather than a toggle that
                would do nothing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Registration open/closed toggle</p>
              <p>Maintenance mode</p>
              <p>User impersonation (see docs/architecture/super-admin.md)</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
