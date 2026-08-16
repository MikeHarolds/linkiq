'use client';

import type {
  AdminCurrencyDto,
  CreateCountryMappingPayload,
  CreateCurrencyPayload,
  CurrencyCountryMappingDto,
  UpdateCountryMappingPayload,
  UpdateCurrencyPayload,
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  createCountryMapping,
  createCurrency,
  deleteCountryMapping,
  deleteCurrency,
  getCurrencySettings,
  listAuditLogs,
  listCountryMappings,
  listCurrencies,
  updateCountryMapping,
  updateCurrency,
  updateCurrencySettings,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

function CurrencyFormDialog({
  currency,
  onOpenChange,
  onSaved,
}: {
  currency: AdminCurrencyDto | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(currency);
  const [code, setCode] = React.useState(currency?.code ?? '');
  const [name, setName] = React.useState(currency?.name ?? '');
  const [symbol, setSymbol] = React.useState(currency?.symbol ?? '');
  const [numericCode, setNumericCode] = React.useState(currency?.numericCode ?? '');
  const [decimalPlaces, setDecimalPlaces] = React.useState(currency?.decimalPlaces ?? 2);
  const [region, setRegion] = React.useState(currency?.region ?? '');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      if (isEdit && currency) {
        const payload: UpdateCurrencyPayload = {
          name,
          symbol,
          numericCode: numericCode || undefined,
          decimalPlaces,
          region: region || undefined,
        };
        await updateCurrency(currency.id, payload);
      } else {
        const payload: CreateCurrencyPayload = {
          code: code.toUpperCase(),
          name,
          symbol,
          numericCode: numericCode || undefined,
          decimalPlaces,
          region: region || undefined,
        };
        await createCurrency(payload);
      }
      toast.success(isEdit ? 'Currency updated' : 'Currency added');
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save currency');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${currency?.code}` : 'Add currency'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur-code">ISO 4217 code</Label>
              <Input
                id="cur-code"
                value={code}
                disabled={isEdit}
                maxLength={3}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="NGN"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur-symbol">Symbol</Label>
              <Input
                id="cur-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="₦"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-name">Name</Label>
            <Input
              id="cur-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nigerian Naira"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur-numeric">Numeric code</Label>
              <Input
                id="cur-numeric"
                value={numericCode}
                onChange={(e) => setNumericCode(e.target.value)}
                placeholder="566"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur-decimals">Decimal places</Label>
              <Input
                id="cur-decimals"
                type="number"
                min={0}
                max={4}
                value={decimalPlaces}
                onChange={(e) => setDecimalPlaces(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-region">Region</Label>
            <Input
              id="cur-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="West Africa"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !code || !name || !symbol}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MappingFormDialog({
  mapping,
  currencies,
  onOpenChange,
  onSaved,
}: {
  mapping: CurrencyCountryMappingDto | null;
  currencies: AdminCurrencyDto[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(mapping);
  const [countryCode, setCountryCode] = React.useState(mapping?.countryCode ?? '');
  const [countryName, setCountryName] = React.useState(mapping?.countryName ?? '');
  const [currencyId, setCurrencyId] = React.useState(
    mapping?.currencyId ?? currencies[0]?.id ?? '',
  );
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      if (isEdit && mapping) {
        const payload: UpdateCountryMappingPayload = { countryName, currencyId };
        await updateCountryMapping(mapping.id, payload);
      } else {
        const payload: CreateCountryMappingPayload = {
          countryCode: countryCode.toUpperCase(),
          countryName,
          currencyId,
        };
        await createCountryMapping(payload);
      }
      toast.success(isEdit ? 'Mapping updated' : 'Mapping added');
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save mapping');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${mapping?.countryCode}` : 'Add country mapping'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="map-code">ISO 3166-1 code</Label>
              <Input
                id="map-code"
                value={countryCode}
                disabled={isEdit}
                maxLength={2}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                placeholder="NG"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="map-name">Country name</Label>
              <Input
                id="map-name"
                value={countryName}
                onChange={(e) => setCountryName(e.target.value)}
                placeholder="Nigeria"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="map-currency">Currency</Label>
            <select
              id="map-currency"
              value={currencyId}
              onChange={(e) => setCurrencyId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !countryCode || !countryName || !currencyId}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminCurrenciesPage() {
  const queryClient = useQueryClient();
  const [editingCurrency, setEditingCurrency] = React.useState<AdminCurrencyDto | null>(null);
  const [creatingCurrency, setCreatingCurrency] = React.useState(false);
  const [deletingCurrency, setDeletingCurrency] = React.useState<AdminCurrencyDto | null>(null);
  const [editingMapping, setEditingMapping] = React.useState<CurrencyCountryMappingDto | null>(
    null,
  );
  const [creatingMapping, setCreatingMapping] = React.useState(false);
  const [deletingMapping, setDeletingMapping] = React.useState<CurrencyCountryMappingDto | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const { data: currencies, isLoading } = useQuery({
    queryKey: ['admin', 'currencies'],
    queryFn: () => listCurrencies(),
  });
  const { data: settings } = useQuery({
    queryKey: ['admin', 'currency-settings'],
    queryFn: getCurrencySettings,
  });
  const { data: mappings } = useQuery({
    queryKey: ['admin', 'currency-country-mappings'],
    queryFn: listCountryMappings,
  });
  // Sprint 16 — scoped to actions/entities whose name contains
  // "currency" (Currency/CurrencyCountryMapping/CurrencySettings); a
  // PlanPrice change is logged too, but surfaces under the Plans
  // page's own history instead — this page isn't a general audit log
  // browser.
  const { data: auditLog } = useQuery({
    queryKey: ['admin', 'currency-audit'],
    queryFn: () => listAuditLogs({ page: 1, pageSize: 20, search: 'currency' }),
  });

  function invalidate() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'currencies'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'currency-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'currency-audit'] }),
    ]).then(() => undefined);
  }

  function invalidateMappings() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'currency-country-mappings'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'currency-audit'] }),
    ]).then(() => undefined);
  }

  const filtered = (currencies ?? []).filter((c) => {
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term);
  });

  async function toggleActive(currency: AdminCurrencyDto) {
    setBusy(true);
    try {
      await updateCurrency(currency.id, { isActive: !currency.isActive });
      toast.success(currency.isActive ? 'Currency deactivated' : 'Currency activated');
      await invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update currency');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCurrency() {
    if (!deletingCurrency) return;
    setBusy(true);
    try {
      await deleteCurrency(deletingCurrency.id);
      toast.success('Currency deleted');
      await invalidate();
      setDeletingCurrency(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete currency');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMapping() {
    if (!deletingMapping) return;
    setBusy(true);
    try {
      await deleteCountryMapping(deletingMapping.id);
      toast.success('Mapping deleted');
      await invalidateMappings();
      setDeletingMapping(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete mapping');
    } finally {
      setBusy(false);
    }
  }

  async function handleSettingsChange(
    field: 'defaultCurrencyId' | 'fallbackCurrencyId' | 'autoDetectEnabled',
    value: string | boolean,
  ) {
    setBusy(true);
    try {
      await updateCurrencySettings({ [field]: value });
      toast.success('Currency settings updated');
      await invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update settings');
    } finally {
      setBusy(false);
    }
  }

  const activeCount = (currencies ?? []).filter((c) => c.isActive).length;

  return (
    <div>
      <AdminPageHeader
        title="Currencies"
        description="Currency catalogue, localization, and multi-currency payments."
      />

      {/* Currency Overview */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total currencies</CardDescription>
            <CardTitle className="text-2xl">{currencies?.length ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active</CardDescription>
            <CardTitle className="text-2xl">{activeCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Default currency</CardDescription>
            <CardTitle className="text-2xl">
              {settings?.defaultCurrency.code ?? '—'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Auto-detection</CardDescription>
            <CardTitle className="text-2xl">
              {settings ? (settings.autoDetectEnabled ? 'On' : 'Off') : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Default Currency / Fallback / Auto Detection */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Default &amp; fallback currency</CardTitle>
          <CardDescription>
            The default is shown when no other signal is available. The fallback is used
            whenever detection fails, is disabled, or resolves to an inactive/unsupported
            currency.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="default-currency">Default currency</Label>
            <select
              id="default-currency"
              value={settings?.defaultCurrencyId ?? ''}
              disabled={busy || !settings}
              onChange={(e) => handleSettingsChange('defaultCurrencyId', e.target.value)}
              className="flex h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
            >
              {(currencies ?? [])
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fallback-currency">Fallback currency</Label>
            <select
              id="fallback-currency"
              value={settings?.fallbackCurrencyId ?? ''}
              disabled={busy || !settings}
              onChange={(e) => handleSettingsChange('fallbackCurrencyId', e.target.value)}
              className="flex h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
            >
              {(currencies ?? [])
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
            </select>
          </div>
          <Button
            variant="outline"
            disabled={busy || !settings}
            onClick={() =>
              handleSettingsChange('autoDetectEnabled', !(settings?.autoDetectEnabled ?? true))
            }
          >
            {settings?.autoDetectEnabled ? 'Disable auto-detection' : 'Enable auto-detection'}
          </Button>
        </CardContent>
      </Card>

      {/* Currency Catalogue */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Currency catalogue</CardTitle>
            <CardDescription>
              The database is the source of truth — adding a currency here makes it available
              platform-wide immediately.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Search currencies"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Button size="sm" onClick={() => setCreatingCurrency(true)}>
              Add currency
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((currency) => (
                    <TableRow key={currency.id}>
                      <TableCell className="font-mono font-medium">
                        {currency.code}
                        {currency.isDefault && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Default
                          </Badge>
                        )}
                        {currency.isFallback && !currency.isDefault && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Fallback
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{currency.name}</TableCell>
                      <TableCell>{currency.symbol}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {currency.region ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={currency.providerAvailable ? 'success' : 'secondary'}>
                          {currency.providerAvailable ? 'Available' : 'Unavailable'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={currency.isActive ? 'success' : 'destructive'}>
                          {currency.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setEditingCurrency(currency)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => toggleActive(currency)}
                          >
                            {currency.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || currency.isDefault || currency.isFallback}
                            onClick={() => setDeletingCurrency(currency)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No currencies match this search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Country -> Currency Mapping */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Country → currency mapping</CardTitle>
            <CardDescription>
              Drives IP/GeoIP-based currency detection. One row per country — countries
              sharing a currency (e.g. every XOF country) point at the same currency.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreatingMapping(true)}>
            Add mapping
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(mappings ?? []).map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell>{mapping.countryName}</TableCell>
                    <TableCell className="font-mono">{mapping.countryCode}</TableCell>
                    <TableCell>
                      {mapping.currency.code} — {mapping.currency.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setEditingMapping(mapping)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setDeletingMapping(mapping)}
                        >
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(mappings ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No country mappings configured.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Exchange Rates */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Exchange rates</CardTitle>
          <CardDescription>
            No external exchange-rate provider is currently configured. Every plan price
            shown to customers is a fixed, admin-set amount per currency (see the Plans
            page) — nothing is auto-converted. Configuring a real provider is a backend
            deployment change (ExchangeRateService), not something toggled here.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Audit History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent currency activity</CardTitle>
        </CardHeader>
        <CardContent>
          {!auditLog || auditLog.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded activity.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLog.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                      <TableCell>{entry.entity}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Intl.DateTimeFormat('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(entry.createdAt))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {creatingCurrency && (
        <CurrencyFormDialog
          currency={null}
          onOpenChange={setCreatingCurrency}
          onSaved={invalidate}
        />
      )}
      {editingCurrency && (
        <CurrencyFormDialog
          currency={editingCurrency}
          onOpenChange={(open) => !open && setEditingCurrency(null)}
          onSaved={invalidate}
        />
      )}
      {creatingMapping && (
        <MappingFormDialog
          mapping={null}
          currencies={currencies ?? []}
          onOpenChange={setCreatingMapping}
          onSaved={invalidateMappings}
        />
      )}
      {editingMapping && (
        <MappingFormDialog
          mapping={editingMapping}
          currencies={currencies ?? []}
          onOpenChange={(open) => !open && setEditingMapping(null)}
          onSaved={invalidateMappings}
        />
      )}

      <ConfirmDialog
        open={Boolean(deletingCurrency)}
        onOpenChange={(open) => !open && setDeletingCurrency(null)}
        title={`Delete ${deletingCurrency?.code}?`}
        description="Only possible when this currency has no plan prices, country mappings, or user preferences. This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={handleDeleteCurrency}
      />
      <ConfirmDialog
        open={Boolean(deletingMapping)}
        onOpenChange={(open) => !open && setDeletingMapping(null)}
        title={`Remove mapping for ${deletingMapping?.countryName}?`}
        description="Visitors from this country will no longer be auto-detected into a specific currency."
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={handleDeleteMapping}
      />
    </div>
  );
}
