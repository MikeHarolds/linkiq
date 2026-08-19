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
import type { ReactNode } from 'react';

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
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function statusVariant(
  status: string,
): 'success' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'PAID') return 'success';
  if (status === 'VOID' || status === 'UNCOLLECTIBLE' || status === 'FAILED') {
    return 'destructive';
  }
  if (status === 'REFUNDED') return 'secondary';
  return 'outline';
}

/**
 * Sprint 18B §10 — "View Invoice": every field a customer invoice
 * center is expected to surface (number, date, plan, amount, currency,
 * status, provider, reference, paid date, billing period). Read-only —
 * this dialog never mutates anything, it's a formatted view over the
 * exact same Invoice row the billing-history table already has.
 */
export function InvoiceDetailDialog({
  invoice,
  currencies,
  onClose,
}: {
  invoice: InvoiceDto;
  currencies: CurrencyDto[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invoice {invoice.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <Row label="Status">
            <Badge variant={statusVariant(invoice.status)}>
              {invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()}
            </Badge>
          </Row>
          <Row label="Plan">{invoice.targetPlan?.name ?? '—'}</Row>
          <Row label="Amount">
            <span className="font-semibold tabular-nums">
              {formatAmount(invoice.amount, invoice.currency, currencies)}
            </span>
          </Row>
          <Row label="Currency">{invoice.currency}</Row>
          <Row label="Billing period">
            {invoice.periodStart
              ? `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`
              : '—'}
          </Row>
          <Row label="Payment provider">{invoice.provider ?? '—'}</Row>
          <Row label="Payment reference">
            <span className="font-mono text-xs">
              {invoice.providerInvoiceId ?? '—'}
            </span>
          </Row>
          <Row label="Issued">{formatDate(invoice.issueDate)}</Row>
          <Row label="Due">{formatDate(invoice.dueDate)}</Row>
          <Row label="Paid">{formatDate(invoice.paidAt)}</Row>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
