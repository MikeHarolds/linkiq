'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ApiKeyPermission, CreatedApiKeyDto } from '@linkiq/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@linkiq/ui';
import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { createApiKey } from '@/lib/api-keys-api';
import {
  createApiKeySchema,
  type CreateApiKeyFormValues,
} from '@/lib/validations/api-keys';
import { ApiError } from '@/providers/auth-provider';

import { PERMISSION_GROUPS, PERMISSION_LABELS } from './permission-labels';

interface CreateApiKeyDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (apiKey: CreatedApiKeyDto) => void;
}

export function CreateApiKeyDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: CreateApiKeyDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [createdKey, setCreatedKey] = React.useState<CreatedApiKeyDto | null>(
    null,
  );
  const [copied, setCopied] = React.useState(false);
  // Deliberately starts empty — there is no implicit "all access" default;
  // the caller must explicitly pick at least one scope.
  const [permissions, setPermissions] = React.useState<Set<ApiKeyPermission>>(
    new Set(),
  );
  const [permissionsError, setPermissionsError] = React.useState<string | null>(
    null,
  );

  const form = useForm<CreateApiKeyFormValues>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: '', expiresAt: '' },
  });

  function togglePermission(permission: ApiKeyPermission) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
    setPermissionsError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setCreatedKey(null);
      setCopied(false);
      setPermissions(new Set());
      setPermissionsError(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(values: CreateApiKeyFormValues) {
    if (permissions.size === 0) {
      setPermissionsError('Select at least one permission.');
      return;
    }
    setIsSubmitting(true);
    try {
      const apiKey = await createApiKey(workspaceId, {
        name: values.name,
        permissions: Array.from(permissions),
        expiresAt: values.expiresAt
          ? new Date(values.expiresAt).toISOString()
          : undefined,
      });
      setCreatedKey(apiKey);
      onCreated(apiKey);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to create API key',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Your API key will only be shown once. Copy it now — LinkIQ
                cannot display it again.
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-sm font-medium">
                  {createdKey.key}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={copyKey}
                  aria-label="Copy API key"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Production Website" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expiresAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expiration (optional)</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <p className="text-sm font-medium leading-none">
                    Permissions
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This key can only do what you select here — nothing is
                    granted by default.
                  </p>
                  <div className="space-y-3 rounded-md border p-3">
                    {PERMISSION_GROUPS.map((group) => (
                      <div key={group.label} className="space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground">
                          {group.label}
                        </p>
                        {group.permissions.map((permission) => (
                          <label
                            key={permission}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input"
                              checked={permissions.has(permission)}
                              onChange={() => togglePermission(permission)}
                            />
                            {PERMISSION_LABELS[permission]}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  {permissionsError && (
                    <p className="text-sm font-medium text-destructive">
                      {permissionsError}
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating…' : 'Create API key'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
