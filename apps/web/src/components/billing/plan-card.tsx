'use client';

import type { CurrencyDto, PlanDto } from '@linkiq/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@linkiq/ui';
import { formatCurrency } from '@linkiq/utils';

import { FEATURE_LABELS } from './feature-labels';

/** Sprint 16 — resolves which price to display: the plan's own
 * currency-specific PlanPrice for `currencyCode` if one exists,
 * otherwise the plan's base currency/amount (never assumes automatic
 * conversion — see Sprint 16 §9). */
function resolvePrice(
  plan: PlanDto,
  currencyCode: string | undefined,
): { amount: number; currencyCode: string } {
  if (!currencyCode || currencyCode === plan.currency) {
    return { amount: plan.priceAmount, currencyCode: plan.currency };
  }
  const match = plan.prices.find((p) => p.currencyCode === currencyCode);
  return match
    ? { amount: match.amount, currencyCode: match.currencyCode }
    : { amount: plan.priceAmount, currencyCode: plan.currency };
}

function formatPrice(
  plan: PlanDto,
  currencyCode: string | undefined,
  currencies: CurrencyDto[],
): string {
  const resolved = resolvePrice(plan, currencyCode);
  if (resolved.amount === 0) {
    return plan.tier === 'ENTERPRISE' ? 'Custom pricing' : 'Free';
  }
  const meta = currencies.find((c) => c.code === resolved.currencyCode);
  const major = meta
    ? formatCurrency(resolved.amount, meta)
    : (resolved.amount / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: resolved.currencyCode,
        minimumFractionDigits: 0,
      });
  return `${major}/${plan.billingInterval === 'ANNUAL' ? 'yr' : 'mo'}`;
}

interface PlanCardProps {
  plan: PlanDto;
  isCurrent: boolean;
  canManage: boolean;
  busy: boolean;
  onSelect: (planSlug: string) => void;
  /** Sprint 16 — which currency to display the price in; omitted uses
   * the plan's own base currency. */
  displayCurrencyCode?: string;
  /** The active currency catalogue, for symbol/decimalPlaces — omitted
   * falls back to Intl's built-in currency formatting. */
  currencies?: CurrencyDto[];
}

export function PlanCard({
  plan,
  isCurrent,
  canManage,
  busy,
  onSelect,
  displayCurrencyCode,
  currencies = [],
}: PlanCardProps) {
  return (
    <Card
      className={
        isCurrent
          ? 'border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.3),0_0_24px_-8px_hsl(var(--primary)/0.4)]'
          : 'transition-colors hover:border-primary/30'
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{plan.name}</span>
          {isCurrent && <Badge variant="default">Current plan</Badge>}
        </CardTitle>
        {plan.description && (
          <CardDescription>{plan.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-semibold tracking-tight">
          {formatPrice(plan, displayCurrencyCode, currencies)}
        </p>
        {plan.trialDays ? (
          <p className="text-xs text-muted-foreground">
            {plan.trialDays}-day free trial on subscribe
          </p>
        ) : null}
        <ul className="space-y-1 text-sm text-muted-foreground">
          {plan.limits.map((limit) => (
            <li key={limit.key}>
              {FEATURE_LABELS[limit.key] ?? limit.key}:{' '}
              {limit.value === null
                ? 'Unlimited'
                : limit.value.toLocaleString()}
            </li>
          ))}
        </ul>
      </CardContent>
      {canManage && (
        <CardFooter>
          <Button
            className="w-full"
            variant={isCurrent ? 'outline' : 'default'}
            disabled={isCurrent || busy}
            onClick={() => onSelect(plan.slug)}
          >
            {isCurrent
              ? 'Current plan'
              : busy
                ? 'Updating…'
                : 'Switch to this plan'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
