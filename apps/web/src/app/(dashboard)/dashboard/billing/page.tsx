'use client';

import type { CurrencyDto, InvoiceDto, PlanDto } from '@linkiq/types';
import {
  Badge,
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
import { formatCurrency } from '@linkiq/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';

import { USAGE_BAR_KEYS } from '@/components/billing/feature-labels';
import { InvoiceDetailDialog } from '@/components/billing/invoice-detail-dialog';
import { InvoiceReviewDialog } from '@/components/billing/invoice-review-dialog';
import { PlanCard } from '@/components/billing/plan-card';
import { PlanChangeConfirmDialog } from '@/components/billing/plan-change-confirm-dialog';
import { ReceiptDialog } from '@/components/billing/receipt-dialog';
import { SubscriptionStatusBadge } from '@/components/billing/subscription-status-badge';
import { UsageRow } from '@/components/billing/usage-row';
import { CurrencySelect } from '@/components/currency/currency-select';
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import {
  cancelSubscription,
  changePlan,
  getBillingSummary,
  getInvoices,
  getMyEntitlement,
  getPlans,
  proceedToPayment,
  reactivateSubscription,
  subscribe,
} from '@/lib/billing-api';
import { ApiError, useAuth } from '@/providers/auth-provider';
import { useCurrency } from '@/providers/currency-provider';

function formatAmount(
  amount: number,
  code: string,
  currencies: CurrencyDto[],
): string {
  const meta = currencies.find((c) => c.code === code);
  return meta
    ? formatCurrency(amount, meta)
    : (amount / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: code,
      });
}

function invoiceStatusVariant(
  status: string,
): 'success' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'PAID') return 'success';
  if (status === 'VOID' || status === 'UNCOLLECTIBLE' || status === 'FAILED') {
    return 'destructive';
  }
  if (status === 'REFUNDED') return 'secondary';
  return 'outline';
}

/** "professional-user" -> "Professional" — never the raw role slug or
 * id, per Part 19 of the sprint spec ("Professional Plan," not
 * "platformRoleId = uuid..."). */
function formatRoleName(slug: string | null): string | null {
  if (!slug) return null;
  return slug
    .replace(/-user$/, '')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function BillingDashboardPage() {
  const { currentWorkspaceId, workspaces, user } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = workspaces.find((w) => w.id === currentWorkspaceId)?.role;
  // Deliberately narrower than every other Sprint 6/7 "can manage"
  // check in this dashboard — billing is ADMIN/OWNER only, MEMBER can
  // view but not mutate. See docs/architecture/billing.md §RBAC.
  const canManage = currentRole === 'OWNER' || currentRole === 'ADMIN';

  const { currency, currencies, setCurrency } = useCurrency();
  const [busyPlanSlug, setBusyPlanSlug] = React.useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = React.useState(false);
  const [pendingPlan, setPendingPlan] = React.useState<PlanDto | null>(null);
  // Sprint 18A — set once a paid plan selection creates a PENDING
  // invoice; the invoice-review screen replaces PlanChangeConfirmDialog
  // while this is non-null. Cleared on cancel (the invoice itself stays
  // PENDING and retriable — see InvoicesService.createOrReusePendingInvoice).
  const [pendingInvoice, setPendingInvoice] = React.useState<InvoiceDto | null>(
    null,
  );
  const [payBusy, setPayBusy] = React.useState(false);
  // Sprint 18B §10/§11 — the customer invoice center's "View Invoice"
  // and "View Receipt" dialogs. Both are read-only views over the
  // exact same Invoice row already fetched by invoicesQuery below —
  // never a second network round-trip, never a fabricated value.
  const [viewingInvoice, setViewingInvoice] = React.useState<InvoiceDto | null>(
    null,
  );
  const [viewingReceipt, setViewingReceipt] = React.useState<InvoiceDto | null>(
    null,
  );
  // Sprint 18B — NGN is the platform default (docs/architecture/
  // currency.md); this only matters for the brief window before
  // useCurrency's own resolution (explicit > preference > IP > platform
  // default) has returned a value.
  const checkoutCurrencyCode = currency?.code ?? 'NGN';

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

  const entitlementQuery = useQuery({
    queryKey: ['my-entitlement'],
    queryFn: getMyEntitlement,
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ['billing', currentWorkspaceId],
    });
    queryClient.invalidateQueries({
      queryKey: ['billing-plans', currentWorkspaceId],
    });
  }

  async function handleSelectPlan(plan: PlanDto) {
    if (!currentWorkspaceId) return;
    setBusyPlanSlug(plan.slug);
    try {
      const hasSubscription = Boolean(summaryQuery.data?.subscription);
      const result = hasSubscription
        ? await changePlan(currentWorkspaceId, plan.slug, checkoutCurrencyCode)
        : await subscribe(currentWorkspaceId, plan.slug, checkoutCurrencyCode);
      if (result.invoice) {
        // Sprint 18A — a PENDING invoice was created for review; nothing
        // about the subscription has changed. Keep `pendingPlan` set
        // (the invoice-review screen needs it) and layer the invoice-
        // review screen on top instead of redirecting or toasting
        // success — the plan is NOT active yet.
        setPendingInvoice(result.invoice);
        return;
      }
      if (result.checkoutUrl) {
        // Only reachable via reactivate's older direct-checkout path
        // (unaffected by this sprint) — nothing is applied yet, the
        // browser must complete checkout there.
        window.location.href = result.checkoutUrl;
        return;
      }
      toast.success(
        hasSubscription
          ? `Switched to the ${plan.name} plan`
          : `Subscribed to the ${plan.name} plan`,
      );
      setPendingPlan(null);
      invalidate();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to update plan',
      );
    } finally {
      setBusyPlanSlug(null);
    }
  }

  async function handleProceedToPayment() {
    if (!currentWorkspaceId || !pendingInvoice) return;
    setPayBusy(true);
    try {
      const { checkoutUrl } = await proceedToPayment(
        currentWorkspaceId,
        pendingInvoice.id,
      );
      window.location.href = checkoutUrl;
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to start payment',
      );
      setPayBusy(false);
    }
  }

  /** Retries a still-PENDING invoice straight from the billing-history
   * table (Part 9 — "abandoned payment... invoice must be retriable")
   * without re-walking the plan-selection step. */
  async function handleRetryInvoice(invoice: InvoiceDto) {
    if (!currentWorkspaceId) return;
    setPayBusy(true);
    try {
      const { checkoutUrl } = await proceedToPayment(
        currentWorkspaceId,
        invoice.id,
      );
      window.location.href = checkoutUrl;
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to start payment',
      );
      setPayBusy(false);
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
        error instanceof ApiError
          ? error.message
          : 'Failed to cancel subscription',
      );
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleReactivate() {
    if (!currentWorkspaceId) return;
    setCancelBusy(true);
    try {
      const result = await reactivateSubscription(currentWorkspaceId);
      if (result.checkoutUrl) {
        // The underlying provider subscription was already disabled at
        // cancel()-time — reactivating requires a fresh checkout, same as
        // an upgrade. See SubscriptionsService.reactivate's docs.
        window.location.href = result.checkoutUrl;
        return;
      }
      toast.success('Subscription reactivated');
      invalidate();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to reactivate subscription',
      );
    } finally {
      setCancelBusy(false);
    }
  }

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view billing.
      </p>
    );
  }

  if (summaryQuery.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="py-12 text-center text-muted-foreground"
      >
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
      <DashboardPageHeader
        title="Billing"
        description="Manage your plan, usage, and billing history."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{summary.plan.name}</span>
            {subscription && (
              <SubscriptionStatusBadge status={subscription.effectiveStatus} />
            )}
          </CardTitle>
          <CardDescription>
            {/* Sprint 16 — the SUBSCRIPTION's own recorded currency/amount
                (immutable once set — see Sprint 16 §12), never re-derived
                from the plan's current price catalog or the visitor's
                currency preference. */}
            {(() => {
              const amount = subscription
                ? subscription.amount
                : summary.plan.priceAmount;
              const code = subscription
                ? subscription.currency
                : summary.plan.currency;
              if (amount === 0) return 'Free';
              return `${formatAmount(amount, code, currencies)} / ${summary.plan.billingInterval === 'ANNUAL' ? 'year' : 'month'}`;
            })()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {entitlementQuery.data?.role && (
            <p className="text-muted-foreground">
              Your access level:{' '}
              <span className="font-medium text-foreground">
                {formatRoleName(entitlementQuery.data.role)}
              </span>
            </p>
          )}
          {subscription && (
            <p className="text-muted-foreground">
              Current period: {formatDate(subscription.billingPeriod.start)} –{' '}
              {formatDate(subscription.billingPeriod.end)}
            </p>
          )}
          {subscription?.trial && (
            <p className="text-muted-foreground">
              Trial: {formatDate(subscription.trial.start)} –{' '}
              {formatDate(subscription.trial.end)}
            </p>
          )}
          {subscription?.cancellation && (
            <p className="text-amber-600 dark:text-amber-400">
              Scheduled to cancel on{' '}
              {formatDate(subscription.cancellation.cancelAt)} — access
              continues until then.
            </p>
          )}
          {canManage && subscription && (
            <div className="pt-2">
              {hasPendingCancellation ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelBusy}
                  onClick={handleReactivate}
                >
                  {cancelBusy ? 'Reactivating…' : 'Reactivate subscription'}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelBusy}
                  onClick={handleCancel}
                >
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
          <CardDescription>
            Based on your current plan&apos;s limits.
          </CardDescription>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Plans</h2>
          {currencies.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Currency</span>
              <CurrencySelect
                value={checkoutCurrencyCode}
                onChange={(code) => void setCurrency(code)}
              />
            </div>
          )}
        </div>
        {plansQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading plans…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(plansQuery.data ?? []).map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={plan.slug === currentPlanSlug}
                canManage={canManage}
                busy={busyPlanSlug === plan.slug}
                onSelect={() => setPendingPlan(plan)}
                displayCurrencyCode={checkoutCurrencyCode}
                currencies={currencies}
              />
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            Every invoice for this workspace — pending, paid, and failed.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!invoicesQuery.data || invoicesQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoicesQuery.data.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-sm">
                      {invoice.number}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invoice.targetPlan?.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={invoiceStatusVariant(invoice.status)}>
                        {invoice.status.charAt(0) +
                          invoice.status.slice(1).toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {formatAmount(
                        invoice.amount,
                        invoice.currency,
                        currencies,
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canManage && invoice.status === 'PENDING' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={payBusy}
                            onClick={() => void handleRetryInvoice(invoice)}
                          >
                            Pay now
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingInvoice(invoice)}
                        >
                          View Invoice
                        </Button>
                        {invoice.status === 'PAID' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewingReceipt(invoice)}
                          >
                            View Receipt
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>
            Every payment attempt that actually reached the payment provider —
            pending invoices with no attempt yet are not shown here (see
            Invoices above).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {(() => {
            const attempts = (invoicesQuery.data ?? []).filter(
              (i) => i.status === 'PAID' || i.status === 'FAILED',
            );
            if (attempts.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  No payment attempts yet.
                </p>
              );
            }
            return (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(invoice.paidAt ?? invoice.issueDate)}
                      </TableCell>
                      <TableCell className="capitalize">
                        {invoice.provider ?? '—'}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {formatAmount(
                          invoice.amount,
                          invoice.currency,
                          currencies,
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            invoice.status === 'PAID'
                              ? 'success'
                              : 'destructive'
                          }
                        >
                          {invoice.status === 'PAID' ? 'Success' : 'Failed'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            );
          })()}
        </CardContent>
      </Card>

      {pendingPlan && !pendingInvoice && (
        <PlanChangeConfirmDialog
          targetPlan={pendingPlan}
          currentAmount={subscription?.amount ?? summary.plan.priceAmount}
          currentPlanName={summary.plan.name}
          currencyCode={checkoutCurrencyCode}
          currencies={currencies}
          activeProvider={summary.activeProvider}
          busy={busyPlanSlug === pendingPlan.slug}
          onCurrencyChange={(code) => void setCurrency(code)}
          onConfirm={() => void handleSelectPlan(pendingPlan)}
          onCancel={() => setPendingPlan(null)}
        />
      )}

      {pendingPlan && pendingInvoice && (
        <InvoiceReviewDialog
          invoice={pendingInvoice}
          targetPlan={pendingPlan}
          currentPlanName={summary.plan.name}
          currencies={currencies}
          activeProvider={summary.activeProvider}
          busy={payBusy}
          onProceed={() => void handleProceedToPayment()}
          onCancel={() => {
            setPendingInvoice(null);
            setPendingPlan(null);
          }}
        />
      )}

      {viewingInvoice && (
        <InvoiceDetailDialog
          invoice={viewingInvoice}
          currencies={currencies}
          onClose={() => setViewingInvoice(null)}
        />
      )}

      {viewingReceipt && (
        <ReceiptDialog
          invoice={viewingReceipt}
          currencies={currencies}
          customerName={
            user ? `${user.firstName} ${user.lastName}`.trim() : 'Customer'
          }
          customerEmail={user?.email ?? ''}
          onClose={() => setViewingReceipt(null)}
        />
      )}
    </div>
  );
}
