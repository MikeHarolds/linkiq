import Link from 'next/link';

const SECTIONS = [
  {
    title: 'Local Development',
    description: 'Prerequisites, installation, and running LinkIQ locally.',
    href: 'https://github.com/your-org/linkiq/blob/main/docs/installation/local-development.md',
  },
  {
    title: 'Architecture',
    description: 'Monorepo layout, service boundaries, and design decisions.',
    href: 'https://github.com/your-org/linkiq/blob/main/docs/architecture/overview.md',
  },
  {
    title: 'API Reference',
    description: 'REST endpoints, authentication, and error codes.',
    href: 'https://github.com/your-org/linkiq/blob/main/docs/api/README.md',
  },
] as const;

export default function DocsHomePage() {
  return (
    <main className="container flex flex-col gap-8 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">LinkIQ Docs</h1>
        <p className="text-muted-foreground mt-2">
          This app renders LinkIQ&apos;s documentation. Sprint 0 ships the
          scaffold; content grows alongside each feature milestone.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.title}
            href={section.href}
            className="hover:bg-accent rounded-lg border p-5 transition-colors"
          >
            <h2 className="font-medium">{section.title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {section.description}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
