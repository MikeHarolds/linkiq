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

type Status = 'verifying' | 'success' | 'failed';

/**
 * Where the browser lands after a redirect-based Paystack checkout
 * (?reference=...). Sprint 18A — a redirect-back is never trusted as
 * proof of payment: this page calls the callback endpoint, which
 * independently re-verifies the transaction server-side and, only on a
 * verified success, activates the subscription (see
 * SubscriptionsService.confirmAndActivate) — this page then simply
 * reports the ALREADY-DECIDED outcome. Copy is deliberately never
 * worded as if the plan is active before that verification completes
 * (Part 13).
 */
function BillingCallback() {
  const { currentWorkspaceId } = useAuth();
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');
  const [status, setStatus] = React.useState<Status>('verifying');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [newPlanName, setNewPlanName] = React.useState<string | null>(null);

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
        setStatus(result.success ? 'success' : 'failed');
        setNewPlanName(result.subscription?.plan.name ?? null);
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
      description: newPlanName
        ? `Your plan has been upgraded to ${newPlanName}.`
        : 'Your plan has been upgraded.',
    },
    failed: {
      title: 'Payment was not completed.',
      description: errorMessage ?? 'Your current plan is unchanged.',
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
