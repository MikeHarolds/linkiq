import { Button, Card, CardContent, CardHeader } from '@linkiq/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';

export interface PricingCardProps {
  name: string;
  price: string;
  priceSuffix?: string;
  description: string;
  features: string[];
  ctaLabel: string;
  href: string;
  highlighted?: boolean;
}

/** A public, unauthenticated pricing tile — deliberately separate from
 * components/billing/plan-card.tsx, which manages an authenticated
 * workspace's live subscription (isCurrent/onSelect/etc.). This one only
 * ever links out to the public registration flow. */
export function PricingCard({
  name,
  price,
  priceSuffix,
  description,
  features,
  ctaLabel,
  href,
  highlighted = false,
}: PricingCardProps) {
  return (
    <Card
      className={
        highlighted
          ? 'relative border-orange-300 shadow-md ring-1 ring-orange-300 dark:border-orange-500/40 dark:ring-orange-500/40'
          : 'border-border/80'
      }
    >
      {highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
          Most popular
        </span>
      )}
      <CardHeader className="gap-1">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="text-3xl font-semibold tracking-tight text-foreground">
          {price}
          {priceSuffix && (
            <span className="text-sm font-normal text-muted-foreground">
              {priceSuffix}
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ul className="space-y-2.5">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm">
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              />
              <span className="text-foreground">{feature}</span>
            </li>
          ))}
        </ul>
        <Button
          asChild
          className="w-full"
          variant={highlighted ? 'default' : 'outline'}
        >
          <Link href={href}>{ctaLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
