'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { getPaymentsSettings, testPaystackConnection } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

export default function AdminPaymentsSettingsPage() {
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ connected: boolean; message: string } | null>(
    null,
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'settings', 'payments'],
    queryFn: getPaymentsSettings,
  });

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testPaystackConnection();
      setTestResult(result);
      if (result.connected) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Payment Provider Settings"
        description="The Paystack secret key is never displayed — only whether one is configured."
      />

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load payment settings.'}
        </div>
      )}

      {data && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Paystack
              <Badge variant={data.provider === 'paystack' ? 'success' : 'outline'}>
                {data.provider === 'paystack' ? 'Active provider' : 'Not active'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Secret key</span>
              <Badge variant={data.secretKeyConfigured ? 'success' : 'destructive'}>
                {data.secretKeyConfigured ? 'Configured ✓' : 'Not configured'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Public key</span>
              <Badge variant={data.publicKeyConfigured ? 'success' : 'outline'}>
                {data.publicKeyConfigured ? 'Configured ✓' : 'Not configured'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mode</span>
              <span className="capitalize">{data.mode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Past-due grace period</span>
              <span>{data.pastDueGraceDays} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">API base URL</span>
              <span className="text-xs">{data.apiBaseUrl}</span>
            </div>

            <div className="border-t pt-3">
              <Button size="sm" variant="outline" disabled={testing} onClick={handleTestConnection}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              {testResult && (
                <p
                  className={`mt-2 text-xs ${testResult.connected ? 'text-emerald-600' : 'text-destructive'}`}
                >
                  {testResult.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
