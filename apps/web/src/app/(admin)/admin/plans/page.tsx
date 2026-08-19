'use client';

import type {
  AdminCurrencyDto,
  CreatePlanPayload,
  PlanDto,
  PlanLimitKey,
  PlanTier,
  SetPlanPricePayload,
  UpdatePlanPayload,
} from '@linkiq/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import {
  formatCurrency,
  majorUnitsToMinor,
  minorUnitsToMajorString,
} from '@linkiq/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  createPlan,
  listCurrencies,
  listPlans,
  listRoles,
  removePlanPrice,
  setPlanPrice,
  updatePlan,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PLAN_TIERS: PlanTier[] = [
  'FREE',
  'STARTER',
  'PROFESSIONAL',
  'BUSINESS',
  'ENTERPRISE',
];

const LIMIT_KEYS: PlanLimitKey[] = [
  'MAX_LINKS',
  'MAX_QR_CODES',
  'MAX_CAMPAIGNS',
  'MAX_CUSTOM_DOMAINS',
  'MAX_TEAM_MEMBERS',
  'MONTHLY_CLICKS',
  'ANALYTICS_RETENTION_DAYS',
  'MONTHLY_API_REQUESTS',
  'MAX_WEBHOOK_ENDPOINTS',
  'MONTHLY_WEBHOOK_DELIVERIES',
];

function formatMoney(amount: number, currency: string): string {
  return (amount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency,
  });
}

/** Shared by both dialogs — SUPER_ADMIN is never an option here at all:
 * PlatformRole is a wholly separate table from GlobalRole, so the list
 * this renders (every active PlatformRole) can never include it. */
function RoleSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (roleId: string) => void;
}) {
  const { data: roles } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: listRoles,
  });
  const activeRoles = (roles ?? []).filter((r) => r.isActive);

  return (
    <select
      id="plan-role"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      <option value="">No role (not tied to a plan entitlement)</option>
      {activeRoles.map((role) => (
        <option key={role.id} value={role.id}>
          {role.name}
        </option>
      ))}
    </select>
  );
}

/** Sprint 18B — the ONE editable money field, everywhere a plan price
 * is entered. Holds a DECIMAL major-unit string (what an admin
 * actually types, e.g. "19.99"), never the raw minor-unit integer —
 * conversion to/from minor units happens at the read/save boundary via
 * majorUnitsToMinor/minorUnitsToMajorString (exact string arithmetic,
 * never floating-point multiplication). `step`/decimal handling are
 * driven by the currency's own `decimalPlaces` (from the database-
 * backed Currency catalogue, Sprint 16) — never hardcoded to 2, so a
 * zero-decimal currency (e.g. XOF) or a future 3-decimal one both work
 * correctly with no code change. */
function DecimalMoneyInput({
  id,
  decimalPlaces,
  value,
  onChange,
}: {
  id: string;
  decimalPlaces: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const step = decimalPlaces > 0 ? (1 / 10 ** decimalPlaces).toString() : '1';
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={decimalPlaces > 0 ? `0.${'0'.repeat(decimalPlaces)}` : '0'}
    />
  );
}

/** Currency <select> shared by every dialog that lets an admin choose
 * (or change) which currency a price is denominated in — always shows
 * the code AND name, never leaves the admin guessing (Sprint 18B §3). */
function CurrencySelect({
  id,
  currencies,
  value,
  onChange,
}: {
  id: string;
  currencies: AdminCurrencyDto[];
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      {currencies.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {c.name} ({c.symbol})
        </option>
      ))}
    </select>
  );
}

function EditPlanDialog({
  plan,
  currencies,
  onOpenChange,
  onSaved,
}: {
  plan: PlanDto;
  currencies: AdminCurrencyDto[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(plan.name);
  const [description, setDescription] = React.useState(plan.description ?? '');
  const [currencyCode, setCurrencyCode] = React.useState(plan.currency);
  const currencyMeta = currencies.find((c) => c.code === currencyCode);
  const decimalPlaces = currencyMeta?.decimalPlaces ?? 2;
  const [priceAmount, setPriceAmount] = React.useState(
    minorUnitsToMajorString(plan.priceAmount, decimalPlaces),
  );
  const [trialDays, setTrialDays] = React.useState(
    plan.trialDays !== null ? String(plan.trialDays) : '',
  );
  const [isActive, setIsActive] = React.useState(plan.isActive);
  const [providerPlanId, setProviderPlanId] = React.useState(
    plan.providerPlanId ?? '',
  );
  const [platformRoleId, setPlatformRoleId] = React.useState(
    plan.platformRole?.id ?? '',
  );
  const [isFeaturedOnHomepage, setIsFeaturedOnHomepage] = React.useState(
    plan.isFeaturedOnHomepage,
  );
  const [homepageOrder, setHomepageOrder] = React.useState(
    plan.homepageOrder !== null ? String(plan.homepageOrder) : '',
  );
  const [limits, setLimits] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of LIMIT_KEYS) {
      const existing = plan.limits.find((l) => l.key === key);
      initial[key] =
        existing && existing.value !== null ? String(existing.value) : '';
    }
    return initial;
  });
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    let priceMinorUnits: number;
    try {
      priceMinorUnits = majorUnitsToMinor(priceAmount, decimalPlaces);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid price');
      return;
    }
    setSaving(true);
    try {
      const payload: UpdatePlanPayload = {
        name,
        description: description || null,
        priceAmount: priceMinorUnits,
        currency: currencyCode,
        trialDays: trialDays === '' ? null : Number(trialDays),
        isActive,
        providerPlanId: providerPlanId || null,
        platformRoleId: platformRoleId || null,
        isFeaturedOnHomepage,
        homepageOrder: homepageOrder === '' ? null : Number(homepageOrder),
        limits: Object.fromEntries(
          LIMIT_KEYS.map((key) => [
            key,
            limits[key] === '' ? null : Number(limits[key]),
          ]),
        ) as UpdatePlanPayload['limits'],
      };
      await updatePlan(plan.id, payload);
      toast.success('Plan updated');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update plan',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {plan.name}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="plan-description">Description</Label>
            <Input
              id="plan-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-currency">Currency</Label>
            <CurrencySelect
              id="plan-currency"
              currencies={currencies}
              value={currencyCode}
              onChange={setCurrencyCode}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-price">
              Price ({currencyCode}
              {currencyMeta ? ` ${currencyMeta.symbol}` : ''})
            </Label>
            <DecimalMoneyInput
              id="plan-price"
              decimalPlaces={decimalPlaces}
              value={priceAmount}
              onChange={setPriceAmount}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-trial">Trial days</Label>
            <Input
              id="plan-trial"
              type="number"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              placeholder="No trial"
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="plan-role">Platform role</Label>
            <RoleSelect value={platformRoleId} onChange={setPlatformRoleId} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="plan-provider-id">
              Paystack plan_code{' '}
              <span className="text-xs font-normal text-muted-foreground">
                (optional — checkout uses this plan&apos;s price directly, not a
                Paystack-side plan)
              </span>
            </Label>
            <Input
              id="plan-provider-id"
              value={providerPlanId}
              onChange={(e) => setProviderPlanId(e.target.value)}
              placeholder="Not set — not required for checkout"
            />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input
              id="plan-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="plan-active">Active (purchasable / visible)</Label>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              id="plan-featured"
              type="checkbox"
              checked={isFeaturedOnHomepage}
              onChange={(e) => setIsFeaturedOnHomepage(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="plan-featured">Featured on homepage</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-homepage-order">Homepage position</Label>
            <Input
              id="plan-homepage-order"
              type="number"
              value={homepageOrder}
              onChange={(e) => setHomepageOrder(e.target.value)}
              placeholder="Falls back to display order"
              disabled={!isFeaturedOnHomepage}
            />
          </div>

          <div className="col-span-2">
            <p className="mb-2 text-sm font-medium">
              Limits (blank = unlimited)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {LIMIT_KEYS.map((key) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`limit-${key}`} className="text-xs">
                    {key.replaceAll('_', ' ')}
                  </Label>
                  <Input
                    id={`limit-${key}`}
                    type="number"
                    value={limits[key] ?? ''}
                    onChange={(e) =>
                      setLimits((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder="Unlimited"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatePlanDialog({
  currencies,
  onOpenChange,
  onCreated,
}: {
  currencies: AdminCurrencyDto[];
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [tier, setTier] = React.useState<PlanTier>('STARTER');
  const [description, setDescription] = React.useState('');
  // Sprint 18B — NGN is the platform default currency; a new plan
  // starts pointed at it, never at a hardcoded USD (see
  // docs/architecture/currency.md).
  const [currencyCode, setCurrencyCode] = React.useState(
    currencies.find((c) => c.code === 'NGN')?.code ??
      currencies[0]?.code ??
      'NGN',
  );
  const currencyMeta = currencies.find((c) => c.code === currencyCode);
  const decimalPlaces = currencyMeta?.decimalPlaces ?? 2;
  const [priceAmount, setPriceAmount] = React.useState('0');
  const [trialDays, setTrialDays] = React.useState('');
  const [syncToProvider, setSyncToProvider] = React.useState(false);
  const [platformRoleId, setPlatformRoleId] = React.useState('');
  const [isFeaturedOnHomepage, setIsFeaturedOnHomepage] = React.useState(false);
  const [limits, setLimits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  async function handleCreate() {
    if (!name.trim() || !slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }
    let priceMinorUnits: number;
    try {
      priceMinorUnits = majorUnitsToMinor(priceAmount || '0', decimalPlaces);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid price');
      return;
    }
    setSaving(true);
    try {
      const payload: CreatePlanPayload = {
        name,
        slug,
        tier,
        description: description || undefined,
        priceAmount: priceMinorUnits,
        currency: currencyCode,
        trialDays: trialDays === '' ? null : Number(trialDays),
        limits: Object.fromEntries(
          LIMIT_KEYS.filter(
            (key) => limits[key] !== undefined && limits[key] !== '',
          ).map((key) => [key, Number(limits[key])]),
        ) as CreatePlanPayload['limits'],
        syncToProvider,
        platformRoleId: platformRoleId || null,
        isFeaturedOnHomepage,
      };
      await createPlan(payload);
      toast.success('Plan created');
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create plan',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create plan</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-plan-name">Name</Label>
            <Input
              id="new-plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Growth"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan-slug">
              Slug{' '}
              <span className="text-xs text-muted-foreground">
                (permanent once created)
              </span>
            </Label>
            <Input
              id="new-plan-slug"
              value={slug}
              onChange={(e) =>
                setSlug(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                )
              }
              placeholder="growth"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan-tier">Tier</Label>
            <select
              id="new-plan-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value as PlanTier)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {PLAN_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan-currency">Currency</Label>
            <CurrencySelect
              id="new-plan-currency"
              currencies={currencies}
              value={currencyCode}
              onChange={setCurrencyCode}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan-price">
              Price ({currencyCode}
              {currencyMeta ? ` ${currencyMeta.symbol}` : ''})
            </Label>
            <DecimalMoneyInput
              id="new-plan-price"
              decimalPlaces={decimalPlaces}
              value={priceAmount}
              onChange={setPriceAmount}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="new-plan-description">Description</Label>
            <Input
              id="new-plan-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="new-plan-role">Platform role</Label>
            <RoleSelect value={platformRoleId} onChange={setPlatformRoleId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan-trial">Trial days</Label>
            <Input
              id="new-plan-trial"
              type="number"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              placeholder="No trial"
            />
          </div>
          <div className="flex items-end gap-2 pb-2">
            <input
              id="new-plan-sync"
              type="checkbox"
              checked={syncToProvider}
              onChange={(e) => setSyncToProvider(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="new-plan-sync" className="text-sm">
              Also create this plan on Paystack
            </Label>
          </div>
          <div className="flex items-end gap-2 pb-2">
            <input
              id="new-plan-featured"
              type="checkbox"
              checked={isFeaturedOnHomepage}
              onChange={(e) => setIsFeaturedOnHomepage(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="new-plan-featured" className="text-sm">
              Featured on homepage
            </Label>
          </div>

          <div className="col-span-2">
            <p className="mb-2 text-sm font-medium">
              Limits (blank = unlimited)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {LIMIT_KEYS.map((key) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`new-limit-${key}`} className="text-xs">
                    {key.replaceAll('_', ' ')}
                  </Label>
                  <Input
                    id={`new-limit-${key}`}
                    type="number"
                    value={limits[key] ?? ''}
                    onChange={(e) =>
                      setLimits((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder="Unlimited"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetPlanPriceDialog({
  plan,
  currencies,
  onOpenChange,
  onSaved,
}: {
  plan: PlanDto;
  currencies: AdminCurrencyDto[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const eligible = currencies.filter(
    (c) => c.isActive && c.code !== plan.currency,
  );
  const [currencyId, setCurrencyId] = React.useState(eligible[0]?.id ?? '');
  const selectedCurrency = eligible.find((c) => c.id === currencyId);
  const decimalPlaces = selectedCurrency?.decimalPlaces ?? 2;
  const [amount, setAmount] = React.useState('');
  const [useExchangeRate, setUseExchangeRate] = React.useState(false);
  const [syncToProvider, setSyncToProvider] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!currencyId) {
      toast.error('Choose a currency first');
      return;
    }
    if (!useExchangeRate && amount === '') {
      toast.error('Enter an amount, or use exchange-rate conversion');
      return;
    }
    let amountMinorUnits: number | undefined;
    if (!useExchangeRate) {
      try {
        amountMinorUnits = majorUnitsToMinor(amount, decimalPlaces);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Invalid amount');
        return;
      }
    }
    setSaving(true);
    try {
      const payload: SetPlanPricePayload = {
        currencyId,
        amount: amountMinorUnits,
        useExchangeRate,
        syncToProvider,
      };
      await setPlanPrice(plan.id, payload);
      toast.success('Price saved');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save price',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a price for {plan.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="price-currency">Currency</Label>
            <select
              id="price-currency"
              value={currencyId}
              onChange={(e) => setCurrencyId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {eligible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="price-use-rate"
              type="checkbox"
              checked={useExchangeRate}
              onChange={(e) => setUseExchangeRate(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="price-use-rate" className="text-sm">
              Derive from the base price via exchange rate (requires a
              configured provider)
            </Label>
          </div>
          {!useExchangeRate && (
            <div className="space-y-1.5">
              <Label htmlFor="price-amount">
                Amount ({selectedCurrency?.code ?? '—'}
                {selectedCurrency ? ` ${selectedCurrency.symbol}` : ''})
              </Label>
              <DecimalMoneyInput
                id="price-amount"
                decimalPlaces={decimalPlaces}
                value={amount}
                onChange={setAmount}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              id="price-sync"
              type="checkbox"
              checked={syncToProvider}
              onChange={(e) => setSyncToProvider(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="price-sync" className="text-sm">
              Also create this price on Paystack
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Phase 14's worked example table — Currency / Price / Provider /
 * Status — shown per plan. The base currency row is always first and
 * cannot be removed here (edit the plan's base price via "Edit"
 * instead); additional PlanPrice rows can be added/removed freely. */
function PlanPricesTable({
  plan,
  currenciesByCode,
  onRemove,
}: {
  plan: PlanDto;
  currenciesByCode: Map<string, AdminCurrencyDto>;
  onRemove: (currencyCode: string) => void;
}) {
  function format(code: string, amount: number): string {
    const meta = currenciesByCode.get(code);
    if (!meta) return `${amount} ${code}`;
    return formatCurrency(amount, meta);
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Currency</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-mono">{plan.currency} (base)</TableCell>
            <TableCell>{format(plan.currency, plan.priceAmount)}</TableCell>
            <TableCell>{plan.providerPlanId ? 'Paystack' : '—'}</TableCell>
            <TableCell>
              <Badge variant={plan.providerAvailable ? 'success' : 'secondary'}>
                {plan.providerAvailable ? 'Available' : 'Unavailable'}
              </Badge>
            </TableCell>
            <TableCell />
          </TableRow>
          {plan.prices.map((price) => (
            <TableRow key={price.currencyCode}>
              <TableCell className="font-mono">{price.currencyCode}</TableCell>
              <TableCell>{format(price.currencyCode, price.amount)}</TableCell>
              <TableCell>Paystack</TableCell>
              <TableCell>
                <Badge
                  variant={price.providerAvailable ? 'success' : 'secondary'}
                >
                  {price.providerAvailable ? 'Available' : 'Unavailable'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(price.currencyCode)}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminPlansPage() {
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = React.useState<PlanDto | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [pricingPlan, setPricingPlan] = React.useState<PlanDto | null>(null);
  const [removingPrice, setRemovingPrice] = React.useState<{
    plan: PlanDto;
    currencyCode: string;
  } | null>(null);
  const [removeBusy, setRemoveBusy] = React.useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });
  const { data: currencies } = useQuery({
    queryKey: ['admin', 'currencies'],
    queryFn: () => listCurrencies(),
  });
  const currenciesByCode = React.useMemo(() => {
    const map = new Map<string, AdminCurrencyDto>();
    for (const c of currencies ?? []) map.set(c.code, c);
    return map;
  }, [currencies]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
  }

  async function handleRemovePrice() {
    if (!removingPrice) return;
    const currency = currenciesByCode.get(removingPrice.currencyCode);
    if (!currency) return;
    setRemoveBusy(true);
    try {
      await removePlanPrice(removingPrice.plan.id, currency.id);
      toast.success('Price removed');
      invalidate();
      setRemovingPrice(null);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to remove price',
      );
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Plans"
        description="The platform plan catalog. Pricing and limits shown are the values currently configured — nothing here is invented."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create plan
          </Button>
        }
      />

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-muted-foreground"
        >
          Loading plans…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load plans.'}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((plan) => (
            <Card key={plan.id} className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span>{plan.name}</span>
                  <span className="flex shrink-0 gap-1.5">
                    {plan.isFeaturedOnHomepage && (
                      <Badge variant="default">Featured</Badge>
                    )}
                    <Badge variant={plan.isActive ? 'success' : 'outline'}>
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </span>
                </CardTitle>
                <CardDescription>
                  {/* Sprint 18B §3 — always show the currency CODE
                      alongside the formatted amount, never a bare
                      symbol a viewer has to guess the currency of. */}
                  {plan.priceAmount === 0 ? (
                    'Free'
                  ) : (
                    <>
                      <span className="mr-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                        {plan.currency}
                      </span>
                      {(() => {
                        const meta = currenciesByCode.get(plan.currency);
                        return meta
                          ? formatCurrency(plan.priceAmount, meta)
                          : formatMoney(plan.priceAmount, plan.currency);
                      })()}
                    </>
                  )}
                  {plan.priceAmount > 0 &&
                    ` / ${plan.billingInterval === 'ANNUAL' ? 'year' : 'month'}`}
                  {plan.trialDays ? ` · ${plan.trialDays}-day trial` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1 text-xs text-muted-foreground">
                  {plan.limits.map((l) => (
                    <div key={l.key} className="flex justify-between">
                      <span>{l.key.replaceAll('_', ' ')}</span>
                      <span>{l.value === null ? 'Unlimited' : l.value}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Paystack:{' '}
                  {plan.providerPlanId ? plan.providerPlanId : 'Not configured'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Role: {plan.platformRole ? plan.platformRole.name : 'None'}
                </p>

                <div>
                  <p className="mb-1.5 text-xs font-medium">Currency pricing</p>
                  <PlanPricesTable
                    plan={plan}
                    currenciesByCode={currenciesByCode}
                    onRemove={(currencyCode) =>
                      setRemovingPrice({ plan, currencyCode })
                    }
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setEditingPlan(plan)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setPricingPlan(plan)}
                  >
                    Add price
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editingPlan && (
        <EditPlanDialog
          plan={editingPlan}
          currencies={(currencies ?? []).filter((c) => c.isActive)}
          onOpenChange={(open) => !open && setEditingPlan(null)}
          onSaved={invalidate}
        />
      )}

      {creating && (
        <CreatePlanDialog
          currencies={(currencies ?? []).filter((c) => c.isActive)}
          onOpenChange={(open) => setCreating(open)}
          onCreated={invalidate}
        />
      )}

      {pricingPlan && (
        <SetPlanPriceDialog
          plan={pricingPlan}
          currencies={currencies ?? []}
          onOpenChange={(open) => !open && setPricingPlan(null)}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={Boolean(removingPrice)}
        onOpenChange={(open) => !open && setRemovingPrice(null)}
        title={`Remove ${removingPrice?.currencyCode} price?`}
        description={`This plan will no longer be purchasable in ${removingPrice?.currencyCode}.`}
        confirmLabel="Remove"
        destructive
        busy={removeBusy}
        onConfirm={handleRemovePrice}
      />
    </div>
  );
}
