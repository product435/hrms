import { cn } from "@/lib/utils";

export function Brand({
  className,
  prominent = false,
  onDark = false,
}: {
  className?: string;
  prominent?: boolean;
  onDark?: boolean;
}) {
  return (
    <img
      src={onDark ? "/jeevijay-logo-white.png?v=20260929" : "/jeevijay-logo-dark.png?v=20261127"}
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
