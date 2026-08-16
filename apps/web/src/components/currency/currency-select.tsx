'use client';

import { useCurrency } from '@/providers/currency-provider';

/**
 * Sprint 16 — a plain currency `<select>`, backed entirely by the
 * active currency catalogue from CurrencyProvider. Never a hardcoded
 * list of options (Sprint 16 rule #13) — adding a currency in
 * /admin/currencies makes it selectable here everywhere, with zero
 * code change.
 */
export function CurrencySelect({
  value,
  onChange,
  className,
  'aria-label': ariaLabel = 'Currency',
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const { currencies } = useCurrency();

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        'flex h-9 rounded-md border border-input bg-background px-3 text-sm'
      }
    >
      {currencies.map((c) => (
        <option key={c.id} value={c.code}>
          {c.code} — {c.name}
        </option>
      ))}
    </select>
  );
}
