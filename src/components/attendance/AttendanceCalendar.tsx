import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttendanceCalendarDay, CalendarDayStatus } from "@/types/attendance";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CELL: Record<CalendarDayStatus, { label: string; className: string }> = {
  present: { label: "P", className: "bg-success/15 text-success" },
  late: { label: "L", className: "bg-warning/20 text-warning" },
  "half-day": { label: "HD", className: "bg-warning/15 text-warning" },
  wfh: { label: "W", className: "bg-info/15 text-info" },
  leave: { label: "LV", className: "bg-accent/20 text-accent" },
  holiday: { label: "H", className: "bg-accent/30 text-accent" },
  "week-off": { label: "WO", className: "bg-muted text-muted-foreground" },
  absent: { label: "A", className: "bg-destructive/15 text-destructive" },
  unmarked: { label: "", className: "bg-background text-muted-foreground" },
};

const LEGEND: CalendarDayStatus[] = [
  "present",
  "late",
  "half-day",
  "wfh",
  "leave",
  "holiday",
  "week-off",
  "absent",
];

function monthParts(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const mon = Number(monthText);
  return {
    year: Number.isFinite(year) ? year : 1970,
    mon: Number.isFinite(mon) ? mon : 1,
  };
}

function shiftMonth(month: string, delta: number) {
  const { year, mon } = monthParts(month);
  const next = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const { year, mon } = monthParts(month);
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

export function AttendanceCalendar({
  month,
  days,
  onMonthChange,
}: {
  month: string;
  days: AttendanceCalendarDay[];
  onMonthChange: (month: string) => void;
}) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const { year, mon } = monthParts(month);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const leading = first.getUTCDay();
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells: Array<AttendanceCalendarDay | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: count }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, "0")}`;
      return byDate.get(date) ?? { date, status: "unmarked" as const };
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-semibold">{monthLabel(month)}</p>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="min-h-12 rounded-md" />;
          const tone = CELL[day.status] ?? CELL.unmarked;
          const title = [day.date, day.status, day.note].filter(Boolean).join(" · ");
          return (
            <div
              key={day.date}
              title={title}
              className={`relative flex min-h-12 flex-col items-center justify-center rounded-md border border-border/70 text-xs ${tone.className} ${
                day.missedCheckout ? "ring-1 ring-dashed ring-warning" : ""
              }`}
            >
              <span className="absolute left-1 top-0.5 text-[10px] opacity-70">
                {Number(day.date.slice(8))}
              </span>
              <span className="font-semibold">{tone.label}</span>
              {day.compOffEligible ? (
                <span className="absolute bottom-0.5 right-1 text-[9px] font-medium">CO</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {LEGEND.map((status) => (
          <li key={status} className="inline-flex items-center gap-1.5">
            <span
              className={`grid h-5 min-w-5 place-items-center rounded px-1 font-semibold ${CELL[status].className}`}
            >
              {CELL[status].label}
            </span>
            <span className="capitalize">{status.replace("-", " ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
