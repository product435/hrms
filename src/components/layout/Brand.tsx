import { Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ className, compact, label = "TeamNest" }: { className?: string; compact?: boolean; label?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="gradient-hero grid size-9 shrink-0 place-items-center rounded-xl text-primary-foreground shadow-card">
        <Waypoints className="size-5" />
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span className="block truncate font-display text-base font-bold leading-tight">
            {label}
          </span>
        </span>
      ) : null}
    </div>
  );
}
