import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@linkiq/ui';

export default function DashboardOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">
          This is the dashboard shell established in the foundation sprint.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nothing to show yet</CardTitle>
          <CardDescription>
            Links, campaigns, and analytics widgets are introduced in their
            respective feature milestones.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sprint 0 only establishes architecture and the development environment
          — no business data is wired up yet.
        </CardContent>
      </Card>
    </div>
  );
}
