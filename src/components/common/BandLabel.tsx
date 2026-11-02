import type { PerformanceBand } from "@/types/kra";

function bandClass(band: PerformanceBand) {
  if (band === "Outstanding") return "bg-success/15 text-success";
  if (band === "Exceeds") return "bg-info/15 text-info";
  if (band === "Meets") return "bg-primary/10 text-primary";
  if (band === "Needs Improvement") return "bg-warning/20 text-warning";
  return "bg-muted text-muted-foreground";
}

export function BandLabel({ band }: { band: PerformanceBand }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${bandClass(band)}`}
    >
      {band}
    </span>
  );
}
