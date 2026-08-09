'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@linkiq/ui';

import { useAuth } from '@/providers/auth-provider';

export default function DashboardOverviewPage() {
  const { user, workspaces, currentWorkspaceId } = useAuth();
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back{user ? `, ${user.firstName}` : ''}
        </h1>
        <p className="text-muted-foreground">
          {currentWorkspace
            ? `You're viewing ${currentWorkspace.name} as ${currentWorkspace.role.toLowerCase()}.`
            : 'Select a workspace to get started.'}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nothing to show yet</CardTitle>
          <CardDescription>
            Links, campaigns, and analytics widgets are introduced in their
            respective feature milestones. Sprint 1 established authentication,
            sessions, and workspace/role management — that&apos;s what powers
            the workspace switcher and your account menu above.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Manage your account and workspace members from the settings page.
        </CardContent>
      </Card>
    </div>
  );
}
