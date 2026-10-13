export function PageHeader({ title, subtitle }: { title: string; subtitle: string; isMock?: boolean; generatedAt?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
}
