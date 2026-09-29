import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Moon, Plus, Sun } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { CardsSkeleton } from "@/components/common/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/hooks/useSession";
import { indiaDateKey } from "@/lib/format";
import { attendanceService } from "@/services/attendanceService";

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const Route = createFileRoute("/shifts")({
  beforeLoad: () => requireAuthForPath("/shifts"),
  head: () => ({
    meta: [
      { title: "Shifts & rosters · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Shift definitions with timings, grace period, break minutes, week-offs and assigned headcount.",
      },
      { property: "og:title", content: "Shifts & rosters · JeeVijay HRMS" },
      {
        property: "og:description",
        content: "Define shift timings, grace windows and week-offs, and see who is assigned.",
      },
    ],
  }),
  component: ShiftsPage,
});

function ShiftsPage() {
  const { role } = useSession();
  const canManage = role === "admin" || role === "hr";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string } | null>(null);
  const [assignForm, setAssignForm] = useState({
    employeeId: "",
    effectiveFrom: indiaDateKey(),
    effectiveTo: "",
  });
  const shifts = useQuery({ queryKey: ["shifts"], queryFn: () => attendanceService.shifts() });
  const people = useQuery({
    queryKey: ["shift-assignees"],
    queryFn: () => attendanceService.shiftAssignees(),
    enabled: canManage && assignTarget != null,
  });
  const [form, setForm] = useState({
    name: "",
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: "60",
    graceMinutes: "10",
    isOvernight: false,
    weekOffs: ["Sat", "Sun"] as string[],
  });
  const updateWeekOffs = useMutation({
    mutationFn: (input: { id: string; weekOffs: string[] }) =>
      attendanceService.updateShiftWeekOffs(input.id, input.weekOffs),
    onSuccess: () => {
      toast.success("Week-offs saved");
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (error) =>
      toast.error("Could not save week-offs", {
        description: error instanceof Error ? error.message : "Supabase request failed.",
      }),
  });
  const create = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error("Shift name is required.");
      return attendanceService.createShift({
        name: form.name,
        startTime: form.startTime,
        endTime: form.endTime,
        breakMinutes: Number(form.breakMinutes) || 0,
        graceMinutes: Number(form.graceMinutes) || 0,
        isOvernight: form.isOvernight,
        weekOffs: form.weekOffs,
      });
    },
    onSuccess: () => {
      toast.success("Shift created");
      setOpen(false);
      setForm({
        name: "",
        startTime: "09:00",
        endTime: "18:00",
        breakMinutes: "60",
        graceMinutes: "10",
        isOvernight: false,
        weekOffs: ["Sat", "Sun"],
      });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (e) =>
      toast.error("Could not create shift", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const assign = useMutation({
    mutationFn: () => {
      if (!assignTarget) throw new Error("Choose a shift.");
      return attendanceService.assignEmployeeShift({
        employeeId: assignForm.employeeId,
        shiftId: assignTarget.id,
        effectiveFrom: assignForm.effectiveFrom,
        effectiveTo: assignForm.effectiveTo || null,
      });
    },
    onSuccess: () => {
      toast.success("Shift assigned");
      setAssignTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      void queryClient.invalidateQueries({ queryKey: ["shift-assignees"] });
    },
    onError: (error) =>
      toast.error("Could not assign the shift", {
        description: error instanceof Error ? error.message : "Supabase request failed.",
      }),
  });
  const selectedPerson = (people.data ?? []).find((person) => person.id === assignForm.employeeId);

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Time & attendance"
        title="Shifts & rosters"
        description="Shift patterns that drive attendance status, late marking and overtime calculation."
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New shift
            </Button>
          ) : null
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
                {canManage ? (
                  <WeekOffToggles
                    value={shift.weekOffs}
                    onChange={(weekOffs) => updateWeekOffs.mutate({ id: shift.id, weekOffs })}
                  />
                ) : shift.weekOffs.length ? (
                  shift.weekOffs.map((day) => (
                    <Badge key={day} variant="secondary" className="font-normal">
                      {day}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No week-offs set</span>
                )}
              </div>
              {canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setAssignForm({
                      employeeId: "",
                      effectiveFrom: indiaDateKey(),
                      effectiveTo: "",
                    });
                    setAssignTarget({ id: shift.id, name: shift.name });
                  }}
                >
                  Assign or change
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New shift</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start time</Label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      startTime: e.target.value,
                      isOvernight: form.isOvernight || wrapsOvernight(e.target.value, form.endTime),
                    })
                  }
                />
              </div>
              <div>
                <Label>End time</Label>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      endTime: e.target.value,
                      isOvernight:
                        form.isOvernight || wrapsOvernight(form.startTime, e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Break (min)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.breakMinutes}
                  onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })}
                />
              </div>
              <div>
                <Label>Grace (min)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.graceMinutes}
                  onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isOvernight}
                onChange={(e) =>
                  setForm({
                    ...form,
                    isOvernight: e.target.checked || wrapsOvernight(form.startTime, form.endTime),
                  })
                }
              />
              Overnight (night shift)
            </label>
            <div>
              <Label>Week-offs</Label>
              <WeekOffToggles
                value={form.weekOffs}
                onChange={(weekOffs) => setForm({ ...form, weekOffs })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Create shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignTarget != null} onOpenChange={(next) => !next && setAssignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {assignTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              An earlier open assignment ends the day before this start. The same start date updates
              that assignment.
            </p>
            <div>
              <Label>Employee</Label>
              <Select
                value={assignForm.employeeId}
                onValueChange={(employeeId) => setAssignForm({ ...assignForm, employeeId })}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={people.isLoading ? "Loading people…" : "Choose a person"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(people.data ?? []).map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                      {person.code ? ` · ${person.code}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!people.isLoading && (people.data ?? []).length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No active employees to assign.
                </p>
              ) : null}
              {selectedPerson ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {selectedPerson.currentShiftName
                    ? selectedPerson.effectiveFrom
                      ? `Current shift: ${selectedPerson.currentShiftName} from ${selectedPerson.effectiveFrom}`
                      : `Current shift: ${selectedPerson.currentShiftName} on the employee record`
                    : "No shift is set for this person yet."}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Effective from</Label>
                <Input
                  type="date"
                  value={assignForm.effectiveFrom}
                  onChange={(event) =>
                    setAssignForm({ ...assignForm, effectiveFrom: event.target.value })
                  }
                />
              </div>
              <div>
                <Label>Effective to</Label>
                <Input
                  type="date"
                  value={assignForm.effectiveTo}
                  onChange={(event) =>
                    setAssignForm({ ...assignForm, effectiveTo: event.target.value })
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave effective to empty for an open-ended assignment.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => assign.mutate()}
              disabled={assign.isPending || !assignForm.employeeId}
            >
              {assign.isPending ? "Saving…" : "Save assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function wrapsOvernight(start: string, end: string) {
  return /^\d{2}:\d{2}/.test(start) && /^\d{2}:\d{2}/.test(end) && end <= start;
}

function WeekOffToggles({
  value,
  onChange,
}: {
  value: string[];
  onChange: (days: string[]) => void;
}) {
  const selected = new Set(value.map((day) => day.slice(0, 3).toLowerCase()));
  return (
    <div className="flex flex-wrap gap-1">
      {WEEK_DAYS.map((day) => {
        const on = selected.has(day.toLowerCase().slice(0, 3));
        return (
          <button
            key={day}
            type="button"
            className={`rounded-md px-2 py-1 text-xs ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            onClick={() =>
              onChange(
                on
                  ? value.filter(
                      (item) => item.slice(0, 3).toLowerCase() !== day.toLowerCase().slice(0, 3),
                    )
                  : [...value, day],
              )
            }
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}
