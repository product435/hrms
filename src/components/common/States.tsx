import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string | undefined;
  icon?: LucideIcon | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({
  onRetry,
  message,
}: {
  onRetry?: (() => void) | undefined;
  message?: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-destructive/12 text-destructive">
        <AlertTriangle className="size-6" />
      </span>
      <h3 className="text-base font-semibold">Something went wrong</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {message ?? "We couldn't load this data. Please try again."}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-4" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid items-center gap-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 && "h-8 w-full max-w-40")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-2xl" />
      ))}
    </div>
  );
}