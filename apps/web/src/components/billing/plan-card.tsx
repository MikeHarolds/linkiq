'use client';

import type { PlanDto } from '@linkiq/types';
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

import { FEATURE_LABELS } from './feature-labels';

function formatPrice(plan: PlanDto): string {
  if (plan.priceAmount === 0) {
    return plan.tier === 'ENTERPRISE' ? 'Custom pricing' : 'Free';
  }
  const major = (plan.priceAmount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: plan.currency,
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
}

export function PlanCard({
  plan,
  isCurrent,
  canManage,
  busy,
  onSelect,
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
          {formatPrice(plan)}
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
