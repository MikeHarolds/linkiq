import type { ReactNode } from 'react';

interface DashboardPageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

/** Shared header for every /dashboard page — mirrors
 * components/admin/admin-page-header.tsx's shape so both surfaces
 * belong to the same design system, while staying a separate component
 * (not a shared import) since the dashboard and admin shells are
 * intentionally allowed to diverge independently over time. */
export function DashboardPageHeader({
  title,
  description,
  actions,
}: DashboardPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
