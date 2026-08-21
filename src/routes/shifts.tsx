import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Moon, Plus, Sun } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { CardsSkeleton } from "@/components/common/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { attendanceService } from "@/services/attendanceService";

export const Route = createFileRoute("/shifts")({
  beforeLoad: () => requireAuthForPath("/shifts"),
  head: () => ({
    meta: [
      { title: "Shifts & rosters · TeamNest" },
      {
        name: "description",
        content:
          "Shift definitions with timings, grace period, break minutes, week-offs and assigned headcount.",
      },
      { property: "og:title", content: "Shifts & rosters · TeamNest" },
      {
        property: "og:description",
        content: "Define shift timings, grace windows and week-offs, and see who is assigned.",
      },
    ],
  }),
  component: ShiftsPage,
});

function ShiftsPage() {
  const shifts = useQuery({ queryKey: ["shifts"], queryFn: () => attendanceService.shifts() });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Time & attendance"
        title="Shifts & rosters"
        description="Shift patterns that drive attendance status, late marking and overtime calculation."
        actions={
          <Button>
            <Plus className="size-4" /> New shift
          </Button>
        }
      />

      {shifts.isLoading ? (
        <CardsSkeleton count={3} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(shifts.data ?? []).map((shift) => (
            <article key={shift.id} className="surface-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold">{shift.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {shift.start} – {shift.end}
                  </p>
                </div>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  {shift.isNightShift ? <Moon className="size-5" /> : <Sun className="size-5" />}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Break</dt>
                  <dd className="font-medium">{shift.breakMinutes} min</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Grace</dt>
                  <dd className="font-medium">{shift.graceMinutes} min</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Assigned</dt>
                  <dd className="font-medium">{shift.assigned} people</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Type</dt>
                  <dd className="font-medium">{shift.isNightShift ? "Night" : "Day"}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <CalendarClock className="size-3.5 text-muted-foreground" />
                {shift.weekOffs.map((day) => (
                  <Badge key={day} variant="secondary" className="font-normal">
                    {day}
                  </Badge>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
