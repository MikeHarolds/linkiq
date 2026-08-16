'use client';

import type { CreatePlanPayload, PlanDto, PlanLimitKey, PlanTier, UpdatePlanPayload } from '@linkiq/types';
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
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { createPlan, listPlans, updatePlan } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const PLAN_TIERS: PlanTier[] = ['FREE', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'];

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
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency });
}

function EditPlanDialog({
  plan,
  onOpenChange,
  onSaved,
}: {
  plan: PlanDto;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(plan.name);
  const [description, setDescription] = React.useState(plan.description ?? '');
  const [priceAmount, setPriceAmount] = React.useState(String(plan.priceAmount));
  const [trialDays, setTrialDays] = React.useState(plan.trialDays !== null ? String(plan.trialDays) : '');
  const [isActive, setIsActive] = React.useState(plan.isActive);
  const [providerPlanId, setProviderPlanId] = React.useState(plan.providerPlanId ?? '');
  const [limits, setLimits] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of LIMIT_KEYS) {
      const existing = plan.limits.find((l) => l.key === key);
      initial[key] = existing && existing.value !== null ? String(existing.value) : '';
    }
    return initial;
  });
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: UpdatePlanPayload = {
        name,
        description: description || null,
        priceAmount: Number(priceAmount),
        trialDays: trialDays === '' ? null : Number(trialDays),
        isActive,
        providerPlanId: providerPlanId || null,
        limits: Object.fromEntries(
          LIMIT_KEYS.map((key) => [key, limits[key] === '' ? null : Number(limits[key])]),
        ) as UpdatePlanPayload['limits'],
      };
      await updatePlan(plan.id, payload);
      toast.success('Plan updated');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update plan');
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
            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="plan-description">Description</Label>
            <Input id="plan-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-price">Price ({plan.currency} cents)</Label>
            <Input
              id="plan-price"
              type="number"
              value={priceAmount}
              onChange={(e) => setPriceAmount(e.target.value)}
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
            <Label htmlFor="plan-provider-id">Paystack plan_code</Label>
            <Input
              id="plan-provider-id"
              value={providerPlanId}
              onChange={(e) => setProviderPlanId(e.target.value)}
              placeholder="Not configured for automated checkout"
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

          <div className="col-span-2">
            <p className="mb-2 text-sm font-medium">Limits (blank = unlimited)</p>
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
                    onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder="Unlimited"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [tier, setTier] = React.useState<PlanTier>('STARTER');
  const [description, setDescription] = React.useState('');
  const [priceAmount, setPriceAmount] = React.useState('0');
  const [trialDays, setTrialDays] = React.useState('');
  const [syncToProvider, setSyncToProvider] = React.useState(false);
  const [limits, setLimits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  async function handleCreate() {
    if (!name.trim() || !slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }
    setSaving(true);
    try {
      const payload: CreatePlanPayload = {
        name,
        slug,
        tier,
        description: description || undefined,
        priceAmount: Number(priceAmount) || 0,
        trialDays: trialDays === '' ? null : Number(trialDays),
        limits: Object.fromEntries(
          LIMIT_KEYS.filter((key) => limits[key] !== undefined && limits[key] !== '').map((key) => [
            key,
            Number(limits[key]),
          ]),
        ) as CreatePlanPayload['limits'],
        syncToProvider,
      };
      await createPlan(payload);
      toast.success('Plan created');
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create plan');
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
            <Input id="new-plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan-slug">
              Slug <span className="text-xs text-muted-foreground">(permanent once created)</span>
            </Label>
            <Input
              id="new-plan-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
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
            <Label htmlFor="new-plan-price">Price (cents)</Label>
            <Input
              id="new-plan-price"
              type="number"
              value={priceAmount}
              onChange={(e) => setPriceAmount(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="new-plan-description">Description</Label>
            <Input id="new-plan-description" value={description} onChange={(e) => setDescription(e.target.value)} />
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

          <div className="col-span-2">
            <p className="mb-2 text-sm font-medium">Limits (blank = unlimited)</p>
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
                    onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder="Unlimited"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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

export default function AdminPlansPage() {
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = React.useState<PlanDto | null>(null);
  const [creating, setCreating] = React.useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
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
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
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
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {plan.name}
                  <Badge variant={plan.isActive ? 'success' : 'outline'}>
                    {plan.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {plan.priceAmount === 0 ? 'Free' : formatMoney(plan.priceAmount, plan.currency)}
                  {plan.priceAmount > 0 && ` / ${plan.billingInterval === 'ANNUAL' ? 'year' : 'month'}`}
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
                  Paystack: {plan.providerPlanId ? plan.providerPlanId : 'Not configured'}
                </p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => setEditingPlan(plan)}>
                  Edit
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editingPlan && (
        <EditPlanDialog
          plan={editingPlan}
          onOpenChange={(open) => !open && setEditingPlan(null)}
          onSaved={invalidate}
        />
      )}

      {creating && (
        <CreatePlanDialog onOpenChange={(open) => setCreating(open)} onCreated={invalidate} />
      )}
    </div>
  );
}
