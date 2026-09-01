import { cn } from "@/lib/utils";

export function Brand({ className, compact, label = "JeeVijay HRMS" }: { className?: string; compact?: boolean; label?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-card"
        role="img"
        aria-label={`${label} logo`}
      >
        <img
          src="/jeevijay-hrms-icon.png?v=20260901"
          alt=""
          width="36"
          height="36"
          className="size-full object-contain"
        />
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
