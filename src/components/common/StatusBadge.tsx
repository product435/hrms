import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONE_BY_STATUS: Record<string, Tone> = {
  // generic
  active: "success",
  approved: "success",
  paid: "success",
  present: "success",
  completed: "success",
  resolved: "success",
  reimbursed: "success",
  hired: "success",
  verified: "success",
  "on-track": "success",
  available: "info",
  open: "info",
  wfh: "info",
  assigned: "info",
  "in-progress": "info",
  processing: "info",
  interview: "info",
  screening: "info",
  submitted: "info",
  offer: "accent",
  probation: "warning",
  pending: "warning",
  late: "warning",
  "half-day": "warning",
  "at-risk": "warning",
  "on-hold": "warning",
  "in-repair": "warning",
  notice: "warning",
  draft: "neutral",
  applied: "neutral",
  "not-started": "neutral",
  closed: "neutral",
  cancelled: "neutral",
  retired: "neutral",
  "week-off": "neutral",
  holiday: "accent",
  leave: "accent",
  absent: "danger",
  rejected: "danger",
  delayed: "danger",
  lost: "danger",
  resigned: "danger",
  suspended: "danger",
  terminated: "danger",
  critical: "danger",
  urgent: "danger",
  damaged: "danger",
};

const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  success: "bg-success/12 text-success ring-success/25",
  warning: "bg-warning/18 text-warning ring-warning/30",
  danger: "bg-destructive/12 text-destructive ring-destructive/25",
  info: "bg-info/12 text-info ring-info/25",
  accent: "bg-accent/15 text-accent ring-accent/30",
};

function humanize(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({
  status,
  tone,
  className,
}: {
  status: string | null | undefined;
  tone?: Tone;
  className?: string;
}) {
  const value = status ?? "";
  const resolved = tone ?? TONE_BY_STATUS[value.toLowerCase()] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        toneClasses[resolved],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {value ? humanize(value) : "—"}
    </span>
  );
}
