'use client';

import type {
  CreateRolePayload,
  PermissionKey,
  PlatformRoleDto,
  UpdateRolePayload,
} from '@linkiq/types';
import { PERMISSION_KEYS } from '@linkiq/types';
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
import { Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { createRole, deleteRole, listRoles, updateRole } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

/** Grouped purely for the checkbox layout — no meaning beyond readability. */
const PERMISSION_GROUPS: Array<{ label: string; keys: PermissionKey[] }> = [
  {
    label: 'Links',
    keys: ['LINKS_VIEW', 'LINKS_CREATE', 'LINKS_EDIT', 'LINKS_DELETE'],
  },
  { label: 'Analytics', keys: ['ANALYTICS_VIEW', 'ANALYTICS_ADVANCED'] },
  {
    label: 'Domains',
    keys: ['DOMAINS_VIEW', 'DOMAINS_CREATE', 'DOMAINS_DELETE'],
  },
  {
    label: 'QR Codes',
    keys: ['QR_CODES_VIEW', 'QR_CODES_CREATE', 'QR_CODES_DELETE'],
  },
  {
    label: 'Campaigns',
    keys: [
      'CAMPAIGNS_VIEW',
      'CAMPAIGNS_CREATE',
      'CAMPAIGNS_EDIT',
      'CAMPAIGNS_DELETE',
    ],
  },
  { label: 'API Keys', keys: ['API_VIEW', 'API_CREATE', 'API_REVOKE'] },
  {
    label: 'Webhooks',
    keys: [
      'WEBHOOKS_VIEW',
      'WEBHOOKS_CREATE',
      'WEBHOOKS_EDIT',
      'WEBHOOKS_DELETE',
    ],
  },
  { label: 'Billing', keys: ['BILLING_VIEW', 'BILLING_MANAGE'] },
];

// Sanity check at module load — every PermissionKey must be represented
// exactly once above, so the checkbox grid is never silently missing a
// permission the backend actually enforces.
if (process.env.NODE_ENV !== 'production') {
  const grouped = new Set(PERMISSION_GROUPS.flatMap((g) => g.keys));
  for (const key of PERMISSION_KEYS) {
    if (!grouped.has(key)) {
      // eslint-disable-next-line no-console
      console.warn(`PERMISSION_GROUPS is missing "${key}"`);
    }
  }
}

function RoleFormDialog({
  role,
  onOpenChange,
  onSaved,
}: {
  role?: PlatformRoleDto;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!role;
  const [name, setName] = React.useState(role?.name ?? '');
  const [slug, setSlug] = React.useState(role?.slug ?? '');
  const [description, setDescription] = React.useState(role?.description ?? '');
  const [permissions, setPermissions] = React.useState<Set<PermissionKey>>(
    new Set(role?.permissions ?? []),
  );
  const [saving, setSaving] = React.useState(false);

  function togglePermission(key: PermissionKey) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!isEdit && !slug.trim()) {
      toast.error('Slug is required');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const payload: UpdateRolePayload = {
          name,
          description: description || undefined,
          permissions: [...permissions],
        };
        await updateRole(role.id, payload);
        toast.success('Role updated');
      } else {
        const payload: CreateRolePayload = {
          name,
          slug,
          description: description || undefined,
          permissions: [...permissions],
        };
        await createRole(payload);
        toast.success('Role created');
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save role',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${role.name}` : 'Create role'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-slug">Slug</Label>
              <Input
                id="role-slug"
                value={slug}
                disabled={isEdit}
                onChange={(e) =>
                  setSlug(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
                  )
                }
                maxLength={50}
                placeholder="growth-partner"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-2">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.keys.map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={permissions.has(key)}
                          onChange={() => togglePermission(key)}
                        />
                        {key}
                      </label>
                    ))}
                  </div>
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
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminRolesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<PlatformRoleDto | null>(null);
  const [deleting, setDeleting] = React.useState<PlatformRoleDto | null>(null);
  const [busy, setBusy] = React.useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: listRoles,
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
  }

  async function toggleActive(role: PlatformRoleDto) {
    setBusy(true);
    try {
      await updateRole(role.id, { isActive: !role.isActive });
      toast.success(role.isActive ? 'Role deactivated' : 'Role activated');
      await invalidate();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update role',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRole(deleting.id);
      toast.success('Role deleted');
      await invalidate();
      setDeleting(null);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete role',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Roles"
        description="Platform-level product entitlements. Attach a role to a plan to grant it automatically on subscribe."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create role
          </Button>
        }
      />

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="py-12 text-center text-sm text-muted-foreground"
        >
          Loading…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load roles.'}
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-muted-foreground">
          No roles yet.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.map((role) => (
            <Card key={role.id}>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{role.name}</CardTitle>
                    <Badge variant={role.isActive ? 'success' : 'outline'}>
                      {role.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {role.isSystem && <Badge variant="secondary">System</Badge>}
                  </div>
                  <CardDescription className="mt-1">
                    {role.description || role.slug}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setEditing(role)}
                    aria-label="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!role.isSystem && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDeleting(role)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{role.userCount} user(s)</span>
                  {role.plans.length > 0 && (
                    <span>
                      Plan(s): {role.plans.map((p) => p.name).join(', ')}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {role.permissions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No permissions granted
                    </span>
                  ) : (
                    role.permissions.map((p) => (
                      <Badge
                        key={p}
                        variant="secondary"
                        className="font-mono text-[10px]"
                      >
                        {p}
                      </Badge>
                    ))
                  )}
                </div>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => toggleActive(role)}
                  >
                    {role.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <RoleFormDialog
          role={editing ?? undefined}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete role?"
        description={`"${deleting?.name}" will be permanently removed. Rejected if it still has assigned users or plans.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
