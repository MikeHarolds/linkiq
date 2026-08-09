'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { api } from '@/lib/api-client';
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordFormValues,
  type UpdateProfileFormValues,
} from '@/lib/validations/auth';
import { ApiError, useAuth } from '@/providers/auth-provider';

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

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your profile, password, and sessions.
        </p>
      </div>
      <ProfileSection />
      <Separator />
      <PasswordSection />
      <Separator />
      <SessionsSection />
    </div>
  );
}
