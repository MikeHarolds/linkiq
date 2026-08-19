'use client';

import type { CurrencyDto, InvoiceDto, PlanDto } from '@linkiq/types';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@linkiq/ui';
import { formatCurrency } from '@linkiq/utils';

export interface InvoiceReviewDialogProps {
  invoice: InvoiceDto;
  targetPlan: PlanDto;
  currentPlanName: string;
  currencies: CurrencyDto[];
  activeProvider: string | null;
  busy: boolean;
  onProceed: () => void;
  onCancel: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

/**
 * Sprint 18A, Part 2 — the invoice/payment review screen shown after a
 * paid plan selection creates a PENDING invoice, before any Paystack
 * transaction exists. Deliberately never calls a subscription-
 * activation endpoint — "Proceed to Payment" only ever calls
 * POST .../invoices/:id/pay (proceedToPayment), which redirects to
 * Paystack; nothing here implies the plan is already active (Part 13:
 * never word this screen as if the plan is active before payment).
 */
export function InvoiceReviewDialog({
  invoice,
  targetPlan,
  currentPlanName,
  currencies,
  activeProvider,
  busy,
  onProceed,
  onCancel,
}: InvoiceReviewDialogProps) {
  const currencyMeta = currencies.find((c) => c.code === invoice.currency);
  const totalLabel = currencyMeta
    ? formatCurrency(invoice.amount, currencyMeta)
    : `${invoice.amount} ${invoice.currency}`;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review invoice {invoice.number}</DialogTitle>
          <DialogDescription>
            {currentPlanName} → {targetPlan.name} — payment is required before
            this change takes effect.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Invoice number
              </span>
              <span className="font-mono text-xs">{invoice.number}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Plan</span>
              <span>{targetPlan.name}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Billing period
              </span>
              <span>
                {targetPlan.billingInterval === 'ANNUAL' ? 'Annual' : 'Monthly'}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Due date</span>
              <span>{formatDate(invoice.dueDate)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">
                Total
              </span>
              <span className="text-lg font-semibold tracking-tight">
                {totalLabel}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Payment gateway
            </p>
            {activeProvider ? (
              <div className="flex items-center gap-2 rounded-md border p-2.5">
                <span className="capitalize">{activeProvider}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  Available
                </Badge>
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
                No payment gateway is configured in this environment.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            You&apos;re still on the {currentPlanName} plan. Proceeding takes
            you to {activeProvider ? 'Paystack' : 'the payment provider'} to
            complete payment — your plan only changes after payment succeeds.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onProceed} disabled={busy || !activeProvider}>
            {busy ? 'Redirecting…' : 'Proceed to Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
