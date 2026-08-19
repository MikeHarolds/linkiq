'use client';

import type { PublicPlanDto } from '@linkiq/types';
import { formatCurrency } from '@linkiq/utils';
import * as React from 'react';

import { CurrencySelect } from '@/components/currency/currency-select';
import { useCurrency } from '@/providers/currency-provider';

import { PricingCard } from './pricing-card';

/** Sprint 16 — resolves which price to show for `code`: the plan's own
 * currency-specific PlanPrice if one exists, otherwise the plan's base
 * currency/amount. Never assumes every currency converts automatically
 * (Sprint 16 §9) — a plan simply keeps showing its base price for a
 * currency it hasn't been priced in yet. */
function resolvePrice(
  plan: PublicPlanDto,
  code: string,
): { amount: number; currencyCode: string } {
  if (code === plan.currency) {
    return { amount: plan.priceAmount, currencyCode: plan.currency };
  }
  const match = plan.prices.find((p) => p.currencyCode === code);
  return match
    ? { amount: match.amount, currencyCode: match.currencyCode }
    : { amount: plan.priceAmount, currencyCode: plan.currency };
}

export function PricingCurrencyGrid({
  plans,
  ctaHref,
}: {
  plans: Array<PublicPlanDto & { features: string[] }>;
  ctaHref: string;
}) {
  const { currency, currencies, setCurrency, isLoading } = useCurrency();
  // Sprint 18B — NGN is the platform default (docs/architecture/
  // currency.md), used only before useCurrency's own resolution returns.
  const selectedCode = currency?.code ?? 'NGN';

  return (
    <div>
      {currencies.length > 1 && (
        <div className="mx-auto mb-8 flex max-w-6xl justify-center">
          <CurrencySelect
            value={selectedCode}
            onChange={(code) => void setCurrency(code)}
            aria-label="Pricing currency"
          />
        </div>
      )}

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const resolved = resolvePrice(plan, selectedCode);
          const currencyMeta = currencies.find(
            (c) => c.code === resolved.currencyCode,
          );
          const price =
            resolved.amount === 0
              ? currencyMeta
                ? formatCurrency(0, currencyMeta)
                : '$0'
              : currencyMeta
                ? formatCurrency(resolved.amount, currencyMeta)
                : `${resolved.amount / 100}`;

          return (
            <PricingCard
              key={plan.id}
              name={plan.name}
              price={isLoading ? '…' : price}
              priceSuffix={
                resolved.amount > 0
                  ? plan.billingInterval === 'ANNUAL'
                    ? '/yr'
                    : '/mo'
                  : undefined
              }
              description={plan.description ?? ''}
              features={plan.features}
              ctaLabel="Start for free"
              href={ctaHref}
              highlighted={plan.tier === 'PROFESSIONAL'}
            />
          );
        })}
      </div>
    </div>
  );
}
