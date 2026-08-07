export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
        Foundation Milestone
      </span>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        LinkIQ
      </h1>
      <p className="max-w-md text-muted-foreground">
        Project scaffolding is up and running. Dashboard, auth, and product
        features land in the next milestones.
      </p>
    </main>
  );
}
