import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { CardsSkeleton } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/useSession";
import { talentService } from "@/services/talentService";
import { employeeService } from "@/services/employeeService";
import { percent, shortDate } from "@/lib/format";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => requireAuthForPath("/onboarding"),
  head: () => ({
    meta: [
      { title: "Onboarding journeys · TeamNest" },
      {
        name: "description",
        content:
          "Track new-hire onboarding checklists, task owners, buddy assignment and completion progress.",
      },
      { property: "og:title", content: "Onboarding · TeamNest" },
      {
        property: "og:description",
        content: "New-hire checklists with owners, buddies and live completion tracking.",
      },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { role } = useSession();
  const canManage = role === "admin" || role === "hr";
  const queryClient = useQueryClient();
  const journeys = useQuery({ queryKey: ["onboarding"], queryFn: () => talentService.onboarding() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: "", joiningDate: "" });
  const employees = useQuery({
    queryKey: ["employees", "all-for-onboarding"],
    queryFn: () => employeeService.list(),
    enabled: canManage && open,
  });
  const start = useMutation({
    mutationFn: () => {
      if (!form.employeeId) throw new Error("Select the employee joining.");
      if (!form.joiningDate) throw new Error("Set a joining date.");
      return talentService.startOnboarding(form);
    },
    onSuccess: () => {
      toast.success("Onboarding started");
      setOpen(false);
      setForm({ employeeId: "", joiningDate: "" });
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (e) => toast.error("Could not start onboarding", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });

  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});
  const addTask = useMutation({
    mutationFn: (vars: { onboardingId: string; title: string }) =>
      talentService.addOnboardingTask(vars.onboardingId, { title: vars.title }),
    onSuccess: (_data, vars) => {
      setTaskDrafts((prev) => ({ ...prev, [vars.onboardingId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (e) => toast.error("Could not add task", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });
  const toggleTask = useMutation({
    mutationFn: (vars: { taskId: string; done: boolean }) => talentService.toggleOnboardingTask(vars.taskId, vars.done),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
    onError: (e) => toast.error("Could not update task", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Onboarding journeys"
        description="Every new joiner, their checklist owners and how far along they are."
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <UserPlus className="size-4" /> Start onboarding
            </Button>
          ) : null
        }
      />

      {journeys.isLoading ? (
        <CardsSkeleton count={3} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(journeys.data ?? []).map((journey) => (
            <SectionCard
              key={journey.id}
              title={journey.employeeName}
              description={`${journey.designation} · starts ${shortDate(journey.startDate)} · buddy ${journey.buddy}`}
              bodyClassName="space-y-4 p-5"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Checklist progress</span>
                  <span className="font-semibold text-foreground">{percent(journey.progress)}</span>
                </div>
                <Progress value={journey.progress} className="mt-2 h-2" />
              </div>
              <ul className="space-y-2">
                {journey.tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2.5 text-sm">
                    <button
                      type="button"
                      disabled={!canManage || toggleTask.isPending}
                      onClick={() => toggleTask.mutate({ taskId: task.id, done: !task.done })}
                      className={canManage ? "shrink-0" : "shrink-0 cursor-default"}
                      aria-label={task.done ? `Mark "${task.label}" incomplete` : `Mark "${task.label}" complete`}
                    >
                      {task.done ? (
                        <CheckCircle2 className="size-4 text-success" />
                      ) : (
                        <Circle className="size-4 text-muted-foreground" />
                      )}
                    </button>
                    <span className={task.done ? "truncate text-muted-foreground line-through" : "truncate"}>
                      {task.label}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{task.owner}</span>
                  </li>
                ))}
              </ul>
              {canManage ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const title = (taskDrafts[journey.id] ?? "").trim();
                    if (!title) return;
                    addTask.mutate({ onboardingId: journey.id, title });
                  }}
                >
                  <Input
                    placeholder="Add a checklist task…"
                    value={taskDrafts[journey.id] ?? ""}
                    onChange={(e) => setTaskDrafts((prev) => ({ ...prev, [journey.id]: e.target.value }))}
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={addTask.isPending}>
                    Add
                  </Button>
                </form>
              ) : null}
            </SectionCard>
          ))}
          {journeys.data?.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground lg:col-span-2">
              No onboarding journeys yet.
            </p>
          ) : null}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start onboarding</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Employee</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              >
                <option value="">Select employee</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName} ({e.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Joining date</Label>
              <Input
                type="date"
                value={form.joiningDate}
                onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? "Starting…" : "Start onboarding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
