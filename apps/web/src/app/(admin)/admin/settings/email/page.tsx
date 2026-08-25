'use client';

import type { EmailLogStatus, EmailLogType } from '@linkiq/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import {
  getEmailConfig,
  getEmailStats,
  listEmailLogs,
  sendTestEmail,
  testEmailConnection,
  updateEmailConfig,
} from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const STATUS_BADGE: Record<EmailLogStatus, 'success' | 'destructive' | 'secondary' | 'outline'> = {
  SENT: 'success',
  FAILED: 'destructive',
  QUEUED: 'secondary',
  SENDING: 'secondary',
  SKIPPED: 'outline',
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default function AdminEmailSettingsPage() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const [fromName, setFromName] = React.useState('');
  const [fromEmail, setFromEmail] = React.useState('');
  const [resendApiKey, setResendApiKey] = React.useState('');
  const [smtpHost, setSmtpHost] = React.useState('');
  const [smtpPort, setSmtpPort] = React.useState('');
  const [smtpUsername, setSmtpUsername] = React.useState('');
  const [smtpPassword, setSmtpPassword] = React.useState('');
  const [smtpEncryptionMode, setSmtpEncryptionMode] = React.useState<'NONE' | 'TLS' | 'SSL'>('TLS');
  const [testEmailTo, setTestEmailTo] = React.useState('');
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  const [logFilters, setLogFilters] = React.useState<{
    status?: EmailLogStatus;
    type?: EmailLogType;
    recipientEmail?: string;
  }>({});
  const [page, setPage] = React.useState(1);

  const config = useQuery({ queryKey: ['admin', 'email', 'config'], queryFn: getEmailConfig });
  const stats = useQuery({ queryKey: ['admin', 'email', 'stats'], queryFn: () => getEmailStats('30d') });
  const logs = useQuery({
    queryKey: ['admin', 'email', 'logs', logFilters, page],
    queryFn: () => listEmailLogs({ page, pageSize: 20, ...logFilters }),
  });

  React.useEffect(() => {
    if (!config.data) return;
    setFromName(config.data.fromName);
    setFromEmail(config.data.fromEmail);
    setSmtpHost(config.data.smtpHost ?? '');
    setSmtpPort(config.data.smtpPort ? String(config.data.smtpPort) : '');
    setSmtpUsername(config.data.smtpUsername ?? '');
    setSmtpEncryptionMode(config.data.smtpEncryptionMode);
  }, [config.data]);

  function invalidate() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'email', 'config'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'email', 'stats'] }),
    ]);
  }

  async function handleToggleEnabled() {
    setBusy(true);
    try {
      await updateEmailConfig({ enabled: !config.data?.enabled });
      toast.success(config.data?.enabled ? 'Email service disabled' : 'Email service enabled');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update email service');
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectProvider(provider: 'RESEND' | 'SMTP') {
    setBusy(true);
    try {
      await updateEmailConfig({ provider });
      toast.success(`Provider set to ${provider === 'RESEND' ? 'Resend' : 'SMTP'}`);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update provider');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveFrom() {
    setBusy(true);
    try {
      await updateEmailConfig({ fromName, fromEmail });
      toast.success('Sender details updated');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update sender details');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveResend() {
    setBusy(true);
    try {
      await updateEmailConfig(resendApiKey ? { resendApiKey } : {});
      toast.success('Resend configuration updated');
      setResendApiKey('');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update Resend configuration');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSmtp() {
    setBusy(true);
    try {
      await updateEmailConfig({
        smtpHost,
        smtpPort: smtpPort ? Number(smtpPort) : undefined,
        smtpUsername,
        smtpEncryptionMode,
        ...(smtpPassword ? { smtpPassword } : {}),
      });
      toast.success('SMTP configuration updated');
      setSmtpPassword('');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update SMTP configuration');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleVerification() {
    setBusy(true);
    try {
      await updateEmailConfig({
        requireEmailVerification: !config.data?.requireEmailVerification,
      });
      toast.success('Verification policy updated');
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update verification policy');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEmailType(
    field:
      | 'welcomeEmailsEnabled'
      | 'verificationEmailsEnabled'
      | 'passwordResetEmailsEnabled'
      | 'reportEmailsEnabled',
    label: string,
  ) {
    setBusy(true);
    try {
      await updateEmailConfig({ [field]: !config.data?.[field] });
      toast.success(`${label} ${config.data?.[field] ? 'disabled' : 'enabled'}`);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `Failed to update ${label.toLowerCase()}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleTestConnection() {
    setBusy(true);
    setTestResult(null);
    try {
      const result = await testEmailConnection();
      setTestResult(result);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Connection test failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTest() {
    if (!testEmailTo.trim()) return;
    setBusy(true);
    try {
      await sendTestEmail(testEmailTo.trim());
      toast.success(`Test email queued for ${testEmailTo.trim()}`);
      setTestEmailTo('');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'email', 'logs'] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to send test email');
    } finally {
      setBusy(false);
    }
  }

  const data = config.data;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Email"
        description="Transactional email: verification, welcome, password reset, and analytics reports."
      />

      {config.isLoading ? (
        <div role="status" aria-live="polite" className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile label="Sent" value={String(stats.data?.sent ?? '—')} />
            <StatTile label="Failed" value={String(stats.data?.failed ?? '—')} />
            <StatTile label="Queued" value={String(stats.data?.queued ?? '—')} />
            <StatTile label="Skipped" value={String(stats.data?.skipped ?? '—')} />
            <StatTile
              label="Success rate"
              value={
                stats.data?.successRate === null || stats.data?.successRate === undefined
                  ? '—'
                  : `${Math.round(stats.data.successRate * 100)}%`
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                Service
                <Badge variant={data?.enabled ? 'success' : 'outline'}>
                  {data?.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </CardTitle>
              <CardDescription>
                When disabled, every email is skipped and logged — registration, password reset, and
                report delivery still complete normally.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" disabled={busy} onClick={handleToggleEnabled}>
                  {data?.enabled ? 'Disable email service' : 'Enable email service'}
                </Button>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Provider</span>
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={data?.provider ?? 'RESEND'}
                    disabled={busy}
                    onChange={(e) => handleSelectProvider(e.target.value as 'RESEND' | 'SMTP')}
                  >
                    <option value="RESEND">Resend</option>
                    <option value="SMTP">SMTP</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 border-t pt-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Last successful send</p>
                  <p>{data?.lastSuccessfulSendAt ? new Date(data.lastSuccessfulSendAt).toLocaleString() : '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last failed send</p>
                  <p>{data?.lastFailedSendAt ? new Date(data.lastFailedSendAt).toLocaleString() : '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last connection test</p>
                  <p>
                    {data?.lastConnectionTestAt ? (
                      <>
                        {new Date(data.lastConnectionTestAt).toLocaleString()}{' '}
                        <Badge variant={data.lastConnectionTestOk ? 'success' : 'destructive'}>
                          {data.lastConnectionTestOk ? 'OK' : 'Failed'}
                        </Badge>
                      </>
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                <Button variant="outline" size="sm" disabled={busy} onClick={handleTestConnection}>
                  {busy ? 'Testing…' : 'Test connection'}
                </Button>
                <Input
                  placeholder="you@example.com"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  className="w-56"
                />
                <Button size="sm" disabled={busy || !testEmailTo.trim()} onClick={handleSendTest}>
                  Send test email
                </Button>
              </div>
              {testResult && (
                <p className={`text-xs ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                  {testResult.message}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">From</CardTitle>
              <CardDescription>The name and address every LinkIQ email is sent from.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="fromName">From name</Label>
                <Input id="fromName" value={fromName} onChange={(e) => setFromName(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="fromEmail">From email</Label>
                <Input
                  id="fromEmail"
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                />
              </div>
              <Button disabled={busy} onClick={handleSaveFrom}>
                Save
              </Button>
            </CardContent>
          </Card>

          {data?.provider === 'RESEND' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  Resend
                  <Badge variant={data.resendApiKeyConfigured ? 'success' : 'destructive'}>
                    {data.resendApiKeyConfigured ? 'Configured ✓' : 'Not configured'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  HTTPS API only — no outbound SMTP required. Recommended for Render Free.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="resendApiKey">API key</Label>
                  <Input
                    id="resendApiKey"
                    type="password"
                    placeholder={data.resendApiKeyPrefix ? `${data.resendApiKeyPrefix} (unchanged)` : 're_...'}
                    value={resendApiKey}
                    onChange={(e) => setResendApiKey(e.target.value)}
                  />
                </div>
                <Button disabled={busy} onClick={handleSaveResend}>
                  Save
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  SMTP
                  <Badge variant={data?.smtpPasswordConfigured ? 'success' : 'destructive'}>
                    {data?.smtpPasswordConfigured ? 'Configured ✓' : 'Not configured'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="smtpHost">Host</Label>
                    <Input id="smtpHost" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtpPort">Port</Label>
                    <Input
                      id="smtpPort"
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtpUsername">Username</Label>
                    <Input
                      id="smtpUsername"
                      value={smtpUsername}
                      onChange={(e) => setSmtpUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtpPassword">Password</Label>
                    <Input
                      id="smtpPassword"
                      type="password"
                      placeholder={data?.smtpPasswordConfigured ? 'Unchanged' : ''}
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtpEncryption">Encryption</Label>
                    <select
                      id="smtpEncryption"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={smtpEncryptionMode}
                      onChange={(e) => setSmtpEncryptionMode(e.target.value as 'NONE' | 'TLS' | 'SSL')}
                    >
                      <option value="TLS">TLS</option>
                      <option value="SSL">SSL</option>
                      <option value="NONE">None</option>
                    </select>
                  </div>
                </div>
                <Button disabled={busy} onClick={handleSaveSmtp}>
                  Save
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                Require email verification
                <Badge variant={data?.requireEmailVerification ? 'success' : 'outline'}>
                  {data?.requireEmailVerification ? 'On' : 'Off'}
                </Badge>
              </CardTitle>
              <CardDescription>
                Controls whether unverified accounts see a &ldquo;verify your email&rdquo; prompt in the
                dashboard. Never blocks login.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" disabled={busy} onClick={handleToggleVerification}>
                {data?.requireEmailVerification ? 'Turn off' : 'Turn on'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Email types</CardTitle>
              <CardDescription>
                Enable or disable each kind of outbound email independently — useful for a live demo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    { field: 'welcomeEmailsEnabled', label: 'Welcome emails' },
                    { field: 'verificationEmailsEnabled', label: 'Verification emails' },
                    { field: 'passwordResetEmailsEnabled', label: 'Password reset emails' },
                    { field: 'reportEmailsEnabled', label: 'Analytics reports' },
                  ] as const
                ).map(({ field, label }) => (
                  <div key={field} className="flex items-center justify-between rounded-md border p-3">
                    <span className="text-sm font-medium">{label}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleToggleEmailType(field, label)}
                    >
                      {data?.[field] ? 'On' : 'Off'}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Email logs</CardTitle>
              <CardDescription>Recipient, type, provider, status, and failure reason.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                <select
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={logFilters.status ?? ''}
                  onChange={(e) => {
                    setPage(1);
                    setLogFilters((f) => ({
                      ...f,
                      status: (e.target.value || undefined) as EmailLogStatus | undefined,
                    }));
                  }}
                >
                  <option value="">All statuses</option>
                  {(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'] as const).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={logFilters.type ?? ''}
                  onChange={(e) => {
                    setPage(1);
                    setLogFilters((f) => ({
                      ...f,
                      type: (e.target.value || undefined) as EmailLogType | undefined,
                    }));
                  }}
                >
                  <option value="">All types</option>
                  {(
                    ['VERIFICATION', 'WELCOME', 'PASSWORD_RESET', 'DAILY_REPORT', 'WEEKLY_REPORT', 'TEST'] as const
                  ).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder="Filter by recipient email"
                  className="w-56"
                  value={logFilters.recipientEmail ?? ''}
                  onChange={(e) => {
                    setPage(1);
                    setLogFilters((f) => ({ ...f, recipientEmail: e.target.value || undefined }));
                  }}
                />
              </div>

              {logs.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : !logs.data || logs.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No email activity yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Failure reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.data.items.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>{log.recipientEmail}</TableCell>
                          <TableCell className="text-muted-foreground">{log.type}</TableCell>
                          <TableCell className="text-muted-foreground">{log.provider ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_BADGE[log.status]}>{log.status}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {log.sentAt ? new Date(log.sentAt).toLocaleString() : '—'}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-destructive">
                            {log.failureReason ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Page {logs.data.pagination.page} of {logs.data.pagination.totalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= logs.data.pagination.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
