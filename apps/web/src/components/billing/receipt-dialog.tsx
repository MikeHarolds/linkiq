'use client';

import type { CurrencyDto, InvoiceDto } from '@linkiq/types';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@linkiq/ui';
import { formatCurrency } from '@linkiq/utils';

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

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

function buildReceiptText(params: {
  invoice: InvoiceDto;
  customerName: string;
  customerEmail: string;
  amountLabel: string;
}): string {
  const { invoice, customerName, customerEmail, amountLabel } = params;
  const lines = [
    'LinkIQ',
    'Payment Receipt',
    '',
    `Receipt / Invoice number: ${invoice.number}`,
    `Customer: ${customerName}`,
    `Email: ${customerEmail}`,
    `Plan: ${invoice.targetPlan?.name ?? '—'}`,
    invoice.periodStart
      ? `Billing period: ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`
      : null,
    `Amount: ${amountLabel}`,
    `Currency: ${invoice.currency}`,
    `Payment method/provider: ${invoice.provider ?? '—'}`,
    `Payment reference: ${invoice.providerInvoiceId ?? '—'}`,
    `Payment date: ${formatDate(invoice.paidAt)}`,
    'Status: PAID',
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

/**
 * Sprint 18B §11 — "View Receipt" / "Download Receipt". Only ever
 * rendered for a `status === 'PAID'` invoice (enforced by the caller,
 * BillingDashboardPage) — this never fabricates a payment confirmation
 * for anything that hasn't been independently verified. Reuses the
 * existing Invoice row as the receipt (no separate Receipt entity —
 * see billing.md §7) — the invoice number doubles as the receipt
 * number. "Download" is a plain-text file generated client-side from
 * data already on screen (no PDF-generation service exists in this
 * codebase, and building one wasn't in scope) — still a real,
 * functional download, not a placeholder.
 */
export function ReceiptDialog({
  invoice,
  currencies,
  customerName,
  customerEmail,
  onClose,
}: {
  invoice: InvoiceDto;
  currencies: CurrencyDto[];
  customerName: string;
  customerEmail: string;
  onClose: () => void;
}) {
  const amountLabel = formatAmount(
    invoice.amount,
    invoice.currency,
    currencies,
  );

  function handleDownload() {
    const text = buildReceiptText({
      invoice,
      customerName,
      customerEmail,
      amountLabel,
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linkiq-receipt-${invoice.number}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receipt {invoice.number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 rounded-md border p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">LinkIQ</span>
            <Badge variant="success">PAID</Badge>
          </div>
          <div className="space-y-1 text-muted-foreground">
            <p>{customerName}</p>
            <p>{customerEmail}</p>
          </div>
          <div className="space-y-1.5 border-t pt-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Receipt number</span>
              <span className="font-mono">{invoice.number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span>{invoice.targetPlan?.name ?? '—'}</span>
            </div>
            {invoice.periodStart && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Billing period</span>
                <span>
                  {formatDate(invoice.periodStart)} –{' '}
                  {formatDate(invoice.periodEnd)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment method</span>
              <span className="capitalize">{invoice.provider ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment reference</span>
              <span className="font-mono text-xs">
                {invoice.providerInvoiceId ?? '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment date</span>
              <span>{formatDate(invoice.paidAt)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <span className="font-medium">Total paid</span>
            <span className="text-lg font-semibold tracking-tight">
              {amountLabel}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleDownload}>Download Receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
