import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  delta?: { value: string; direction: "up" | "down" };
  icon?: LucideIcon;
  tone?: "primary" | "accent" | "success" | "warning" | "info" | "destructive" | "neutral";
}

const toneMap: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/18 text-warning",
  info: "bg-info/12 text-info",
  destructive: "bg-destructive/12 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

export function StatCard({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  tone = "primary",
}: StatCardProps) {
  return (
    <article className="surface-card group relative overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-float sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 font-display text-3xl font-bold leading-none tracking-tight">
            {value}
          </p>
        </div>
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-2xl transition-transform duration-200 group-hover:scale-105",
            toneMap[tone],
          )}
        >
          {Icon ? <Icon className="size-5" /> : <BarChart3 className="size-5" />}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
              delta.direction === "up"
                ? "bg-success/12 text-success"
                : "bg-destructive/12 text-destructive",
            )}
          >
            {delta.direction === "up" ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {delta.value}
          </span>
        ) : null}
        {hint ? <span className="truncate text-muted-foreground">{hint}</span> : null}
      </div>
    </article>
  );
}
