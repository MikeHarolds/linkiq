'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ReportDay, ReportFrequency, ReportPreferenceDto } from '@linkiq/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Separator,
} from '@linkiq/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import { api } from '@/lib/api-client';
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordFormValues,
  type UpdateProfileFormValues,
} from '@/lib/validations/auth';
import { ApiError, useAuth } from '@/providers/auth-provider';

const REPORT_DAYS: ReportDay[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

function EmailVerificationBanner() {
  const [isResending, setIsResending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleResend() {
    setIsResending(true);
    try {
      await api.post('/auth/resend-verification');
      setSent(true);
      toast.success('Verification email sent — check your inbox.');
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to resend verification email',
      );
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
      <span>Your email address is not verified.</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isResending || sent}
        onClick={handleResend}
      >
        {sent ? 'Verification email sent' : isResending ? 'Sending…' : 'Resend verification email'}
      </Button>
    </div>
  );
}

function ProfileSection() {
  const { user, refetchMe } = useAuth();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<UpdateProfileFormValues>({
    resolver: zodResolver(updateProfileSchema),
    values: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
    },
  });

  async function onSubmit(values: UpdateProfileFormValues) {
    setIsSubmitting(true);
    try {
      await api.patch('/users/me', values);
      await refetchMe();
      toast.success('Profile updated');
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to update profile',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Update your name and how you appear across LinkIQ.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormItem>
              <FormLabel>Email</FormLabel>
              <Input value={user?.email ?? ''} disabled />
            </FormItem>
            {user && !user.emailVerified && <EmailVerificationBanner />}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

function PasswordSection() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      newPasswordConfirmation: '',
    },
  });

  async function onSubmit(values: ChangePasswordFormValues) {
    setIsSubmitting(true);
    try {
      await api.post('/users/me/change-password', values);
      toast.success('Password changed. Please log in again.');
      router.push('/login');
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to change password',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Changing your password will sign you out of every device.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPasswordConfirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? 'Changing…' : 'Change password'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

function SessionsSection() {
  const router = useRouter();
  const { logoutAll } = useAuth();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleLogoutAll() {
    setIsSubmitting(true);
    try {
      await logoutAll();
      toast.success('Logged out of all devices');
      router.push('/login');
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to log out everywhere',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          Sign out of LinkIQ on every device where you&apos;re currently logged
          in.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          variant="outline"
          onClick={handleLogoutAll}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Logging out…' : 'Log out of all devices'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function NotificationsSection() {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [draft, setDraft] = React.useState<{
    emailReportsEnabled: boolean;
    frequency: ReportFrequency;
    reportDay: ReportDay;
    reportHourUtc: number;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['report-preferences'],
    queryFn: () => api.get<ReportPreferenceDto>('/users/me/report-preferences'),
  });

  React.useEffect(() => {
    if (data) {
      setDraft({
        emailReportsEnabled: data.emailReportsEnabled,
        frequency: data.frequency,
        reportDay: data.reportDay,
        reportHourUtc: data.reportHourUtc,
      });
    }
  }, [data]);

  async function handleSave() {
    if (!draft) return;
    setIsSubmitting(true);
    try {
      await api.patch('/users/me/report-preferences', draft);
      await queryClient.invalidateQueries({ queryKey: ['report-preferences'] });
      toast.success('Report preferences saved');
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to save report preferences',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Receive a daily or weekly summary of your link performance by email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !draft ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Email reports</p>
                <p className="text-xs text-muted-foreground">
                  Overview, top sources, top countries, and top links for the period.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((d) => (d ? { ...d, emailReportsEnabled: !d.emailReportsEnabled } : d))
                }
              >
                {draft.emailReportsEnabled ? 'On' : 'Off'}
              </Button>
            </div>

            {draft.emailReportsEnabled && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Frequency</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={draft.frequency}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, frequency: e.target.value as ReportFrequency } : d,
                      )
                    }
                  >
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                  </select>
                </div>
                {draft.frequency === 'WEEKLY' && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Report day</label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={draft.reportDay}
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, reportDay: e.target.value as ReportDay } : d))
                      }
                    >
                      {REPORT_DAYS.map((day) => (
                        <option key={day} value={day}>
                          {day[0]}
                          {day.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Preferred time</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={draft.reportHourUtc}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, reportHourUtc: Number(e.target.value) } : d))
                    }
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, '0')}:00 UTC
                      </option>
                    ))}
                  </select>
                </div>
                <p className="col-span-full text-xs text-muted-foreground">
                  Reports are sent based on UTC time.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
      <CardFooter>
        <Button type="button" disabled={isSubmitting || !draft} onClick={handleSave}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <DashboardPageHeader
        title="Settings"
        description="Manage your profile, password, and sessions."
      />
      <ProfileSection />
      <Separator />
      <PasswordSection />
      <Separator />
      <SessionsSection />
      <Separator />
      <NotificationsSection />
    </div>
  );
}
