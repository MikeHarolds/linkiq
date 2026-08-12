'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { DomainDto } from '@linkiq/types';
import {
  Badge,
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

import { createDomain, verifyDomain } from '@/lib/domains-api';
import {
  addDomainSchema,
  type AddDomainFormValues,
} from '@/lib/validations/domains';
import { ApiError } from '@/providers/auth-provider';

interface AddDomainDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <code className="flex-1 truncate text-sm">{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function AddDomainDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: AddDomainDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [domain, setDomain] = React.useState<DomainDto | null>(null);

  const form = useForm<AddDomainFormValues>({
    resolver: zodResolver(addDomainSchema),
    defaultValues: { domain: '' },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setDomain(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(values: AddDomainFormValues) {
    setIsSubmitting(true);
    try {
      const created = await createDomain(workspaceId, {
        domain: values.domain,
      });
      setDomain(created);
      onCreated();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to add domain',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify() {
    if (!domain) return;
    setIsVerifying(true);
    try {
      const updated = await verifyDomain(workspaceId, domain.id);
      setDomain(updated);
      onCreated();
      if (updated.status === 'VERIFIED') {
        toast.success('Domain verified! You can now activate it.');
      } else {
        toast.error(
          'Verification record not found yet. DNS changes can take time to propagate — try again shortly.',
        );
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to verify domain',
      );
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {!domain ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a custom domain</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="domain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Domain</FormLabel>
                      <FormControl>
                        <Input placeholder="go.acme.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Adding…' : 'Add domain'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Verify {domain.normalizedDomain}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                LinkIQ never modifies your DNS automatically. Add the following
                TXT record with your DNS provider, then click Verify — DNS
                changes can take a few minutes to propagate.
              </p>
              <CopyField
                label="Record type"
                value={domain.verification.recordType}
              />
              <CopyField
                label="Record name"
                value={domain.verification.recordName}
              />
              <CopyField
                label="Record value"
                value={domain.verification.recordValue}
              />
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status:</span>
                <Badge
                  variant={
                    domain.status === 'VERIFIED'
                      ? 'success'
                      : domain.status === 'FAILED'
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  {domain.status}
                </Badge>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button onClick={handleVerify} disabled={isVerifying}>
                {isVerifying ? 'Verifying…' : 'Verify'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
