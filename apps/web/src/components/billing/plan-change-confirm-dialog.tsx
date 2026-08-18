'use client';

import type { CurrencyDto, PlanDto } from '@linkiq/types';
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
import * as React from 'react';

import { CurrencySelect } from '@/components/currency/currency-select';

/** Sprint 17 §5 — mirrors resolvePlanPrice's logic client-side, for
 * display only. The backend is the sole authority on what's actually
 * charged; this dialog exists to make the (already-enforced) payment
 * requirement visible to the user BEFORE they click confirm, not to
 * enforce it — see SubscriptionsService.determinePaymentRequirement,
 * the real decision point. */
function resolvePrice(
  plan: PlanDto,
  currencyCode: string,
): { amount: number; currencyCode: string } {
  if (currencyCode === plan.currency) {
    return { amount: plan.priceAmount, currencyCode: plan.currency };
  }
  const match = plan.prices.find((p) => p.currencyCode === currencyCode);
  return match
    ? { amount: match.amount, currencyCode: match.currencyCode }
    : { amount: plan.priceAmount, currencyCode: plan.currency };
}

export interface PlanChangeConfirmDialogProps {
  targetPlan: PlanDto;
  /** The subscription's own current immutable amount/currency (Sprint
   * 16) — never the current plan's live price. */
  currentAmount: number;
  currentPlanName: string;
  currencyCode: string;
  currencies: CurrencyDto[];
  /** Sprint 17 §6 — the currently configured gateway's machine name
   * (e.g. "paystack"), or null when none is configured. Drives whether
   * a gateway-selection step shows at all. */
  activeProvider: string | null;
  busy: boolean;
  onCurrencyChange: (code: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Sprint 17 §5 — the "Payment confirmation/checkout UI" step the spec's
 * flow diagram requires between "user selects plan" and "system
 * creates payment/checkout." Never applies anything itself; Confirm
 * simply invokes the parent's existing changePlan/subscribe call,
 * which the backend routes through Paystack checkout or applies
 * directly depending on determinePaymentRequirement's real decision —
 * this dialog's upgrade/downgrade copy is a best-effort preview of
 * that same rule, not a second implementation of it.
 */
export function PlanChangeConfirmDialog({
  targetPlan,
  currentAmount,
  currentPlanName,
  currencyCode,
  currencies,
  activeProvider,
  busy,
  onCurrencyChange,
  onConfirm,
  onCancel,
}: PlanChangeConfirmDialogProps) {
  const resolved = resolvePrice(targetPlan, currencyCode);
  const currencyMeta = currencies.find((c) => c.code === resolved.currencyCode);
  const priceLabel =
    resolved.amount === 0
      ? 'Free'
      : `${currencyMeta ? formatCurrency(resolved.amount, currencyMeta) : resolved.amount} / ${
          targetPlan.billingInterval === 'ANNUAL' ? 'year' : 'month'
        }`;
  const isUpgrade = resolved.amount > currentAmount;
  const hasMultipleCurrencies = currencies.length > 1;
  // Best-effort preview only (see this component's own docs) — the
  // backend independently decides real trial eligibility.
  const mayGetTrial =
    isUpgrade && resolved.amount > 0 && Boolean(targetPlan.trialDays);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch to {targetPlan.name}?</DialogTitle>
          <DialogDescription>
            {currentPlanName} → {targetPlan.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {hasMultipleCurrencies && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Currency
              </p>
              <CurrencySelect
                value={currencyCode}
                onChange={onCurrencyChange}
              />
            </div>
          )}

          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">New price</p>
            <p className="text-lg font-semibold tracking-tight">{priceLabel}</p>
          </div>

          {isUpgrade ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                {mayGetTrial
                  ? `This is an upgrade. If you're eligible, it starts with a ${targetPlan.trialDays}-day free trial — otherwise payment is required now.`
                  : 'This is an upgrade — payment is required to activate it.'}
              </p>
              {resolved.amount > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Payment gateway
                  </p>
                  {activeProvider ? (
                    <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                      <input
                        type="radio"
                        checked
                        readOnly
                        className="h-4 w-4"
                      />
                      <span className="capitalize">{activeProvider}</span>
                      <Badge
                        variant="secondary"
                        className="ml-auto text-[10px]"
                      >
                        Available
                      </Badge>
                    </label>
                  ) : (
                    <p className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
                      No payment gateway is configured in this environment — the
                      change will apply directly.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              This is a downgrade or lateral move — it applies immediately with
              no charge. If you&apos;re on a paid plan today, you won&apos;t be
              billed the old amount again.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy
              ? 'Processing…'
              : isUpgrade && resolved.amount > 0
                ? 'Continue to payment'
                : 'Confirm change'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
