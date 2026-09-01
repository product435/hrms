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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/useSession";
import { attendanceService } from "@/services/attendanceService";

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
  const shifts = useQuery({ queryKey: ["shifts"], queryFn: () => attendanceService.shifts() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: "60",
    graceMinutes: "10",
    isOvernight: false,
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
      });
    },
    onSuccess: () => {
      toast.success("Shift created");
      setOpen(false);
      setForm({ name: "", startTime: "09:00", endTime: "18:00", breakMinutes: "60", graceMinutes: "10", isOvernight: false });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (e) => toast.error("Could not create shift", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New shift</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start time</Label>
                <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </div>
              <div>
                <Label>End time</Label>
                <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Break (min)</Label>
                <Input type="number" min="0" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
              </div>
              <div>
                <Label>Grace (min)</Label>
                <Input type="number" min="0" value={form.graceMinutes} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isOvernight}
                onChange={(e) => setForm({ ...form, isOvernight: e.target.checked })}
              />
              Overnight (night shift)
            </label>
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
    </AppLayout>
  );
}
