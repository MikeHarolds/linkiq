'use client';

import type { PlanDto } from '@linkiq/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
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
import * as React from 'react';
import { toast } from 'sonner';

import { USAGE_BAR_KEYS } from '@/components/billing/feature-labels';
import { PlanCard } from '@/components/billing/plan-card';
import { SubscriptionStatusBadge } from '@/components/billing/subscription-status-badge';
import { UsageRow } from '@/components/billing/usage-row';
import {
  cancelSubscription,
  changePlan,
  getBillingSummary,
  getInvoices,
  getPlans,
  reactivateSubscription,
  subscribe,
} from '@/lib/billing-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function BillingDashboardPage() {
  const { currentWorkspaceId, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  // Deliberately narrower than every other Sprint 6/7 "can manage"
  // check in this dashboard — billing is ADMIN/OWNER only, MEMBER can
  // view but not mutate. See docs/architecture/billing.md §RBAC.
  const canManage = currentRole === 'OWNER' || currentRole === 'ADMIN';

  const [busyPlanSlug, setBusyPlanSlug] = React.useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = React.useState(false);

  const summaryQuery = useQuery({
    queryKey: ['billing', currentWorkspaceId],
    queryFn: () => getBillingSummary(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  const plansQuery = useQuery({
    queryKey: ['billing-plans', currentWorkspaceId],
    queryFn: () => getPlans(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  const invoicesQuery = useQuery({
    queryKey: ['billing-invoices', currentWorkspaceId],
    queryFn: () => getInvoices(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['billing', currentWorkspaceId] });
    queryClient.invalidateQueries({ queryKey: ['billing-plans', currentWorkspaceId] });
  }

  async function handleSelectPlan(plan: PlanDto) {
    if (!currentWorkspaceId) return;
    setBusyPlanSlug(plan.slug);
    try {
      const hasSubscription = Boolean(summaryQuery.data?.subscription);
      if (hasSubscription) {
        await changePlan(currentWorkspaceId, plan.slug);
        toast.success(`Switched to the ${plan.name} plan`);
      } else {
        await subscribe(currentWorkspaceId, plan.slug);
        toast.success(`Subscribed to the ${plan.name} plan`);
      }
      invalidate();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to update plan',
      );
    } finally {
      setBusyPlanSlug(null);
    }
  }

  async function handleCancel() {
    if (!currentWorkspaceId) return;
    if (
      !window.confirm(
        'Cancel at the end of the current billing period? You keep access until then.',
      )
    ) {
      return;
    }
    setCancelBusy(true);
    try {
      await cancelSubscription(currentWorkspaceId);
      toast.success('Cancellation scheduled for the end of the billing period');
      invalidate();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to cancel subscription',
      );
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleReactivate() {
    if (!currentWorkspaceId) return;
    setCancelBusy(true);
    try {
      await reactivateSubscription(currentWorkspaceId);
      toast.success('Subscription reactivated');
      invalidate();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to reactivate subscription',
      );
    } finally {
      setCancelBusy(false);
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">Select a workspace to view billing.</p>
    );
  }

  if (summaryQuery.isLoading) {
    return (
      <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
        Loading billing…
      </div>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <div role="alert" className="py-12 text-center text-destructive">
        {summaryQuery.error instanceof ApiError
          ? summaryQuery.error.message
          : 'Failed to load billing information.'}
      </div>
    );
  }

  const summary = summaryQuery.data;
  const subscription = summary.subscription;
  const currentPlanSlug = summary.plan.slug;
  const hasPendingCancellation = Boolean(subscription?.cancellation);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          No payment provider is connected yet — plan changes below apply
          directly within LinkIQ and never charge any money.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{summary.plan.name}</span>
            {subscription && <SubscriptionStatusBadge status={subscription.effectiveStatus} />}
          </CardTitle>
          <CardDescription>
            {summary.plan.priceAmount === 0
              ? 'Free'
              : `${(summary.plan.priceAmount / 100).toLocaleString('en-US', {
                  style: 'currency',
                  currency: summary.plan.currency,
                })} / ${summary.plan.billingInterval === 'ANNUAL' ? 'year' : 'month'}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {subscription && (
            <p className="text-muted-foreground">
              Current period: {formatDate(subscription.billingPeriod.start)} –{' '}
              {formatDate(subscription.billingPeriod.end)}
            </p>
          )}
          {subscription?.trial && (
            <p className="text-muted-foreground">
              Trial: {formatDate(subscription.trial.start)} – {formatDate(subscription.trial.end)}
            </p>
          )}
          {subscription?.cancellation && (
            <p className="text-amber-600 dark:text-amber-400">
              Scheduled to cancel on {formatDate(subscription.cancellation.cancelAt)} —
              access continues until then.
            </p>
          )}
          {canManage && subscription && (
            <div className="pt-2">
              {hasPendingCancellation ? (
                <Button variant="outline" size="sm" disabled={cancelBusy} onClick={handleReactivate}>
                  {cancelBusy ? 'Reactivating…' : 'Reactivate subscription'}
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled={cancelBusy} onClick={handleCancel}>
                  {cancelBusy ? 'Canceling…' : 'Cancel subscription'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>Based on your current plan&apos;s limits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {USAGE_BAR_KEYS.map((key) => {
            const row = summary.usage.find((u) => u.key === key);
            return row ? (
              <UsageRow
                key={key}
                usageKey={row.key}
                usage={row.usage}
                limit={row.limit}
                remaining={row.remaining}
                unlimited={row.unlimited}
              />
            ) : null;
          })}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Plans</h2>
        {plansQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading plans…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {(plansQuery.data ?? []).map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={plan.slug === currentPlanSlug}
                canManage={canManage}
                busy={busyPlanSlug === plan.slug}
                onSelect={() => handleSelectPlan(plan)}
              />
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Billing history</CardTitle>
          <CardDescription>Invoices appear here once a payment provider is connected.</CardDescription>
        </CardHeader>
        <CardContent>
          {!invoicesQuery.data || invoicesQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Issued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoicesQuery.data.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>{invoice.number}</TableCell>
                    <TableCell>{invoice.status}</TableCell>
                    <TableCell>
                      {(invoice.amount / 100).toLocaleString('en-US', {
                        style: 'currency',
                        currency: invoice.currency,
                      })}
                    </TableCell>
                    <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
