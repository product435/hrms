import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="grid grid-cols-1 items-start gap-5 sm:flex sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">{actions}</div>
      ) : null}
    </header>
  );
}
