'use client';

import type {
  LandingPageFaqDto,
  LandingPageFeatureDto,
  LandingPageIconKey,
  LandingPageSectionDto,
  LandingPageSectionKey,
  LandingPageStatDto,
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
  Textarea,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { LANDING_PAGE_ICON_MAP } from '@/components/marketing/icon-map';
import {
  createFaq,
  createFeature,
  createStat,
  deleteFaq,
  deleteFeature,
  deleteStat,
  getLandingPageContent,
  reorderFaqs,
  reorderFeatures,
  reorderStats,
  updateFaq,
  updateFeature,
  updateLandingPageSection,
  updateStat,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const ICON_KEYS = Object.keys(LANDING_PAGE_ICON_MAP) as LandingPageIconKey[];

const SIMPLE_SECTIONS: Array<{ key: LandingPageSectionKey; label: string; hasCta: boolean }> = [
  { key: 'HERO', label: 'Hero', hasCta: true },
  { key: 'PRODUCT_SHOWCASE', label: 'Product Showcase', hasCta: false },
  { key: 'CUSTOM_DOMAINS', label: 'Custom Domains', hasCta: false },
  { key: 'DEVELOPERS', label: 'Developers', hasCta: true },
  { key: 'PRICING', label: 'Pricing', hasCta: false },
  { key: 'CTA', label: 'Final CTA', hasCta: true },
];

function findSection(sections: LandingPageSectionDto[], key: LandingPageSectionKey) {
  return sections.find((s) => s.key === key);
}

// --- Section text editor (Hero/Product Showcase/Custom Domains/Developers/Pricing/CTA) ---

function SectionEditDialog({
  sectionKey,
  label,
  hasCta,
  section,
  onOpenChange,
  onSaved,
}: {
  sectionKey: LandingPageSectionKey;
  label: string;
  hasCta: boolean;
  section?: LandingPageSectionDto;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [eyebrow, setEyebrow] = React.useState(section?.eyebrow ?? '');
  const [headline, setHeadline] = React.useState(section?.headline ?? '');
  const [description, setDescription] = React.useState(section?.description ?? '');
  const [primaryCtaText, setPrimaryCtaText] = React.useState(section?.primaryCtaText ?? '');
  const [primaryCtaUrl, setPrimaryCtaUrl] = React.useState(section?.primaryCtaUrl ?? '');
  const [secondaryCtaText, setSecondaryCtaText] = React.useState(section?.secondaryCtaText ?? '');
  const [secondaryCtaUrl, setSecondaryCtaUrl] = React.useState(section?.secondaryCtaUrl ?? '');
  const [isActive, setIsActive] = React.useState(section?.isActive ?? true);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateLandingPageSection(sectionKey, {
        isActive,
        eyebrow: eyebrow || null,
        headline: headline || null,
        description: description || null,
        primaryCtaText: hasCta ? primaryCtaText || null : undefined,
        primaryCtaUrl: hasCta ? primaryCtaUrl || null : undefined,
        secondaryCtaText: hasCta ? secondaryCtaText || null : undefined,
        secondaryCtaUrl: hasCta ? secondaryCtaUrl || null : undefined,
      });
      toast.success(`${label} section updated`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update section');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              id="section-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="section-active">Visible on the public page</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="section-eyebrow">Eyebrow</Label>
            <Input id="section-eyebrow" value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="section-headline">Headline</Label>
            <Input id="section-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="section-description">Description</Label>
            <Textarea
              id="section-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
          {hasCta && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="section-primary-cta-text">Primary CTA text</Label>
                  <Input
                    id="section-primary-cta-text"
                    value={primaryCtaText}
                    onChange={(e) => setPrimaryCtaText(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="section-primary-cta-url">Primary CTA URL</Label>
                  <Input
                    id="section-primary-cta-url"
                    value={primaryCtaUrl}
                    onChange={(e) => setPrimaryCtaUrl(e.target.value)}
                    placeholder="/register or #pricing"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="section-secondary-cta-text">Secondary CTA text</Label>
                  <Input
                    id="section-secondary-cta-text"
                    value={secondaryCtaText}
                    onChange={(e) => setSecondaryCtaText(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="section-secondary-cta-url">Secondary CTA URL</Label>
                  <Input
                    id="section-secondary-cta-url"
                    value={secondaryCtaUrl}
                    onChange={(e) => setSecondaryCtaUrl(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
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

// --- Icon picker (shared by Feature/Stat forms) ---

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      {ICON_KEYS.map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
    </select>
  );
}

// --- Features management ---

function FeatureFormDialog({
  feature,
  onOpenChange,
  onSaved,
}: {
  feature?: LandingPageFeatureDto;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState(feature?.title ?? '');
  const [description, setDescription] = React.useState(feature?.description ?? '');
  const [icon, setIcon] = React.useState<string>(feature?.icon ?? 'Sparkles');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required');
      return;
    }
    setSaving(true);
    try {
      if (feature) {
        await updateFeature(feature.id, { title, description, icon: icon as LandingPageIconKey });
      } else {
        await createFeature({ title, description, icon: icon as LandingPageIconKey });
      }
      toast.success(feature ? 'Feature updated' : 'Feature created');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save feature');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{feature ? 'Edit feature' : 'Add feature'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="feature-title">Title</Label>
            <Input id="feature-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feature-description">Description</Label>
            <Textarea
              id="feature-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feature-icon">Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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

function FeaturesManager({ features, onChanged }: { features: LandingPageFeatureDto[]; onChanged: () => void }) {
  const [editing, setEditing] = React.useState<LandingPageFeatureDto | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<LandingPageFeatureDto | null>(null);
  const [busy, setBusy] = React.useState(false);
  const sorted = [...features].sort((a, b) => a.sortOrder - b.sortOrder);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = [...sorted];
    const [item] = reordered.splice(index, 1);
    if (!item) return;
    reordered.splice(target, 0, item);
    setBusy(true);
    try {
      await reorderFeatures(reordered.map((f) => f.id));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reorder');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(feature: LandingPageFeatureDto) {
    setBusy(true);
    try {
      await updateFeature(feature.id, { isActive: !feature.isActive });
      toast.success(feature.isActive ? 'Feature deactivated' : 'Feature activated');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update feature');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteFeature(deleting.id);
      toast.success('Feature deleted');
      onChanged();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete feature');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Features</CardTitle>
          <CardDescription>The &quot;core loop&quot; feature cards. Add, edit, reorder, or hide any of them.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No features yet.</p>
        ) : (
          <div className="divide-y">
            {sorted.map((feature, index) => (
              <div key={feature.id} className="flex items-center gap-3 py-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === sorted.length - 1}
                    onClick={() => move(index, 1)}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{feature.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{feature.description}</p>
                </div>
                <Badge variant={feature.isActive ? 'success' : 'outline'}>
                  {feature.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleActive(feature)}>
                  {feature.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setEditing(feature)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setDeleting(feature)} aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {(editing || adding) && (
        <FeatureFormDialog
          feature={editing ?? undefined}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              setAdding(false);
            }
          }}
          onSaved={onChanged}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete feature?"
        description={`"${deleting?.title}" will be permanently removed from the public page.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </Card>
  );
}

// --- FAQ management ---

function FaqFormDialog({
  faq,
  onOpenChange,
  onSaved,
}: {
  faq?: LandingPageFaqDto;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = React.useState(faq?.question ?? '');
  const [answer, setAnswer] = React.useState(faq?.answer ?? '');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!question.trim() || !answer.trim()) {
      toast.error('Question and answer are required');
      return;
    }
    setSaving(true);
    try {
      if (faq) {
        await updateFaq(faq.id, { question, answer });
      } else {
        await createFaq({ question, answer });
      }
      toast.success(faq ? 'FAQ updated' : 'FAQ created');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save FAQ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{faq ? 'Edit FAQ' : 'Add FAQ'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="faq-question">Question</Label>
            <Input id="faq-question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="faq-answer">Answer</Label>
            <Textarea id="faq-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} maxLength={2000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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

function FaqsManager({ faqs, onChanged }: { faqs: LandingPageFaqDto[]; onChanged: () => void }) {
  const [editing, setEditing] = React.useState<LandingPageFaqDto | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<LandingPageFaqDto | null>(null);
  const [busy, setBusy] = React.useState(false);
  const sorted = [...faqs].sort((a, b) => a.sortOrder - b.sortOrder);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = [...sorted];
    const [item] = reordered.splice(index, 1);
    if (!item) return;
    reordered.splice(target, 0, item);
    setBusy(true);
    try {
      await reorderFaqs(reordered.map((f) => f.id));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reorder');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(faq: LandingPageFaqDto) {
    setBusy(true);
    try {
      await updateFaq(faq.id, { isActive: !faq.isActive });
      toast.success(faq.isActive ? 'FAQ deactivated' : 'FAQ activated');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update FAQ');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteFaq(deleting.id);
      toast.success('FAQ deleted');
      onChanged();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete FAQ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>FAQ</CardTitle>
          <CardDescription>Add, edit, reorder, or hide questions.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No FAQs yet.</p>
        ) : (
          <div className="divide-y">
            {sorted.map((faq, index) => (
              <div key={faq.id} className="flex items-center gap-3 py-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === sorted.length - 1}
                    onClick={() => move(index, 1)}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{faq.question}</p>
                <Badge variant={faq.isActive ? 'success' : 'outline'}>{faq.isActive ? 'Active' : 'Inactive'}</Badge>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleActive(faq)}>
                  {faq.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setEditing(faq)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setDeleting(faq)} aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {(editing || adding) && (
        <FaqFormDialog
          faq={editing ?? undefined}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              setAdding(false);
            }
          }}
          onSaved={onChanged}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete FAQ?"
        description={`"${deleting?.question}" will be permanently removed from the public page.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </Card>
  );
}

// --- Stats management ---

function StatFormDialog({
  stat,
  onOpenChange,
  onSaved,
}: {
  stat?: LandingPageStatDto;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = React.useState(stat?.label ?? '');
  const [sublabel, setSublabel] = React.useState(stat?.sublabel ?? '');
  const [icon, setIcon] = React.useState<string>(stat?.icon ?? 'Sparkles');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!label.trim()) {
      toast.error('Label is required');
      return;
    }
    setSaving(true);
    try {
      if (stat) {
        await updateStat(stat.id, { label, sublabel: sublabel || null, icon: icon as LandingPageIconKey });
      } else {
        await createStat({ label, sublabel: sublabel || null, icon: icon as LandingPageIconKey });
      }
      toast.success(stat ? 'Stat updated' : 'Stat created');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save stat');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stat ? 'Edit stat' : 'Add stat'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="stat-label">Label</Label>
            <Input id="stat-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stat-sublabel">Sub-label</Label>
            <Input id="stat-sublabel" value={sublabel} onChange={(e) => setSublabel(e.target.value)} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stat-icon">Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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

function StatsManager({ stats, onChanged }: { stats: LandingPageStatDto[]; onChanged: () => void }) {
  const [editing, setEditing] = React.useState<LandingPageStatDto | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<LandingPageStatDto | null>(null);
  const [busy, setBusy] = React.useState(false);
  const sorted = [...stats].sort((a, b) => a.sortOrder - b.sortOrder);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = [...sorted];
    const [item] = reordered.splice(index, 1);
    if (!item) return;
    reordered.splice(target, 0, item);
    setBusy(true);
    try {
      await reorderStats(reordered.map((s) => s.id));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reorder');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(stat: LandingPageStatDto) {
    setBusy(true);
    try {
      await updateStat(stat.id, { isActive: !stat.isActive });
      toast.success(stat.isActive ? 'Stat deactivated' : 'Stat activated');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update stat');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteStat(deleting.id);
      toast.success('Stat deleted');
      onChanged();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete stat');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Stats</CardTitle>
          <CardDescription>The capability strip under the hero.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No stats yet.</p>
        ) : (
          <div className="divide-y">
            {sorted.map((stat, index) => (
              <div key={stat.id} className="flex items-center gap-3 py-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === sorted.length - 1}
                    onClick={() => move(index, 1)}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{stat.label}</p>
                  {stat.sublabel && <p className="truncate text-xs text-muted-foreground">{stat.sublabel}</p>}
                </div>
                <Badge variant={stat.isActive ? 'success' : 'outline'}>{stat.isActive ? 'Active' : 'Inactive'}</Badge>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleActive(stat)}>
                  {stat.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setEditing(stat)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setDeleting(stat)} aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {(editing || adding) && (
        <StatFormDialog
          stat={editing ?? undefined}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              setAdding(false);
            }
          }}
          onSaved={onChanged}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete stat?"
        description={`"${deleting?.label}" will be permanently removed from the public page.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </Card>
  );
}

export default function AdminLandingPagePage() {
  const queryClient = useQueryClient();
  const [editingSection, setEditingSection] = React.useState<(typeof SIMPLE_SECTIONS)[number] | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'landing-page'],
    queryFn: getLandingPageContent,
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'landing-page'] });
  }

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="py-12 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div role="alert" className="py-12 text-center text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load landing page content.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Landing Page"
        description="Manage the public marketing site's content, section by section. Changes go live on the next page load."
      />

      <Card>
        <CardHeader>
          <CardTitle>Sections</CardTitle>
          <CardDescription>Copy and calls-to-action for each page section.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {SIMPLE_SECTIONS.map((entry) => {
            const section = findSection(data.sections, entry.key);
            return (
              <div key={entry.key} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{entry.label}</span>
                  <Badge variant={section?.isActive === false ? 'outline' : 'success'}>
                    {section?.isActive === false ? 'Hidden' : 'Visible'}
                  </Badge>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditingSection(entry)}>
                  Edit
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <FeaturesManager features={data.features} onChanged={invalidate} />
      <FaqsManager faqs={data.faqs} onChanged={invalidate} />
      <StatsManager stats={data.stats} onChanged={invalidate} />

      {editingSection && (
        <SectionEditDialog
          sectionKey={editingSection.key}
          label={editingSection.label}
          hasCta={editingSection.hasCta}
          section={findSection(data.sections, editingSection.key)}
          onOpenChange={(open) => !open && setEditingSection(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
