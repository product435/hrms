import { cn } from "@/lib/utils";

export function Brand({
  className,
  compact,
  prominent = false,
  label = "JeeVijay HRMS",
}: {
  className?: string;
  compact?: boolean;
  prominent?: boolean;
  label?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center", prominent ? "gap-3.5" : "gap-2.5", className)}>
      <span
        className={cn(
          "grid shrink-0 place-items-center",
          prominent ? "size-14 sm:size-16" : "size-10",
        )}
        role="img"
        aria-label={`${label} logo`}
      >
        <img
          src="/jeevijay-hrms-logo.png?v=20260902"
          alt=""
          width={prominent ? 64 : 40}
          height={prominent ? 64 : 40}
          className="size-full object-contain drop-shadow-sm"
        />
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate font-display font-bold tracking-tight",
              prominent ? "text-xl leading-none sm:text-2xl" : "text-base leading-tight",
            )}
          >
            {label}
          </span>
        </span>
      ) : null}
    </div>
  );
}
