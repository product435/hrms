import { cn } from "@/lib/utils";

export function Brand({
  className,
  compact,
  prominent = false,
  onDark = false,
  label = "JeeVijay HRMS",
}: {
  className?: string;
  compact?: boolean;
  prominent?: boolean;
  onDark?: boolean;
  label?: string;
}) {
  if (onDark) {
    return (
      <img
        src="/jeevijay-logo-white.png?v=20260929"
        alt="Jeevijay Technologies"
        width={prominent ? 220 : 148}
        height={prominent ? 64 : 44}
        className={cn(
          "w-auto max-w-full object-contain object-left",
          prominent ? "h-16 sm:h-18" : "h-11",
          className,
        )}
      />
    );
  }

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
