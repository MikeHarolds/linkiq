'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@linkiq/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { verifyCheckout } from '@/lib/billing-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

type Status = 'verifying' | 'success' | 'pending' | 'failed';

/**
 * Where the browser lands after a redirect-based Paystack checkout
 * (?reference=...). This is a fast-path UX courtesy only — it never
 * activates anything itself. The inbound Paystack webhook (processed
 * asynchronously, usually within seconds) is the source of truth; this
 * page just reports whether the payment itself succeeded and links back
 * to the billing dashboard, which re-fetches the real subscription state.
 */
function BillingCallback() {
  const { currentWorkspaceId } = useAuth();
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');
  const [status, setStatus] = React.useState<Status>('verifying');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!currentWorkspaceId || !reference) {
      setStatus('failed');
      setErrorMessage('This link is missing a checkout reference.');
      return;
    }
    let cancelled = false;
    verifyCheckout(currentWorkspaceId, reference)
      .then((result) => {
        if (cancelled) return;
        setStatus(result.success ? 'success' : 'pending');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('failed');
        setErrorMessage(
          error instanceof ApiError
            ? error.message
            : 'Could not verify this checkout.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, reference]);

  const copy: Record<Status, { title: string; description: string }> = {
    verifying: {
      title: 'Verifying your payment…',
      description: 'Hang tight while we confirm your checkout with Paystack.',
    },
    success: {
      title: 'Payment successful',
      description:
        'Your plan will update automatically within a few seconds as Paystack confirms the subscription on our end.',
    },
    pending: {
      title: 'Payment not yet confirmed',
      description:
        "We're still waiting to hear back from Paystack about this payment. This can take a moment — check the billing page shortly, or contact support if this persists.",
    },
    failed: {
      title: 'Verification failed',
      description:
        errorMessage ?? 'Something went wrong verifying this checkout.',
    },
  };

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <CardTitle>{copy[status].title}</CardTitle>
          <CardDescription>{copy[status].description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard/billing">Back to billing</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingCallbackPage() {
  return (
    <React.Suspense fallback={null}>
      <BillingCallback />
    </React.Suspense>
  );
}
