'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { getSystemHealth } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

function statusVariant(status: string): 'success' | 'destructive' | 'outline' {
  if (status === 'up' || status === 'ok') return 'success';
  if (status === 'down' || status === 'error') return 'destructive';
  return 'outline';
}

export default function AdminSystemHealthPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'system-health'],
    queryFn: getSystemHealth,
  });

  return (
    <div>
      <AdminPageHeader
        title="System Health"
        description="Real checks against the actual API, database, Redis, job queues, and Paystack — never a hardcoded status."
        actions={
          <Button size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Checking system health…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'One or more health checks failed.'}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(data.details).map(([name, detail]) => (
            <Card key={name}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base capitalize">
                  {name.replaceAll('_', ' ')}
                  <Badge variant={statusVariant(detail.status)}>{detail.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {Object.entries(detail)
                  .filter(([key]) => key !== 'status')
                  .map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span>{key}</span>
                      <span className="max-w-[60%] truncate text-right">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                Paystack
                <Badge variant={data.paystack.connected ? 'success' : 'outline'}>
                  {data.paystack.connected ? 'up' : 'n/a'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{data.paystack.message}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
