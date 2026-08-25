'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@linkiq/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { api } from '@/lib/api-client';
import { ApiError } from '@/providers/auth-provider';

type VerifyState = 'verifying' | 'success' | 'error';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = React.useState<VerifyState>('verifying');
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('This verification link is missing or malformed.');
      return;
    }

    let cancelled = false;
    api
      .post('/auth/verify-email', { token }, { skipAuthRetry: true })
      .then(() => {
        if (!cancelled) setState('success');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState('error');
        setMessage(
          error instanceof ApiError
            ? error.message
            : 'This verification link is invalid or has expired.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'verifying') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verifying your email…</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (state === 'success') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email verified</CardTitle>
          <CardDescription>Your email address has been confirmed.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verification failed</CardTitle>
        <CardDescription>
          {message ?? 'This verification link is invalid or has expired.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Log in and use &ldquo;Resend verification email&rdquo; from your dashboard to get a
          new link.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Go to login</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyEmailContent />
    </React.Suspense>
  );
}
