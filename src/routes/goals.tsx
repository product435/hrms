import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireAuthForPath } from "@/lib/auth-guard";
import { percent, shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { talentService } from "@/services/talentService";
import type { Goal } from "@/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/goals")({
  beforeLoad: () => requireAuthForPath("/goals"),
  head: () => ({
    meta: [{ title: "Goals · JeeVijay HRMS" }],
  }),
  component: GoalsPage,
});

function GoalsPage() {
  const { role, user, isLoading } = useSession();
  const isSelfService = role === "employee";
  const canManageAny = role === "admin" || role === "hr";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false); const [form, setForm] = useState({ title: "", description: "", target: "", dueDate: "", weight: "" }); const queryClient = useQueryClient();

  const goals = useQuery({
    queryKey: ["goals", isSelfService ? (user.employeeId ?? user.id) : "all", search, status],
    queryFn: () =>
      isSelfService
        ? talentService.goalsOf(user.employeeId ?? user.id)
        : talentService.goals({ search, status }),
    enabled: !isLoading,
  });
  const addGoal = useMutation({
    mutationFn: () => {
      if (!(role === "manager" || role === "employee") || !user.employeeId) throw new Error("Your employee profile is not linked.");
      if (!form.title.trim()) throw new Error("Goal title is required.");
      return talentService.createGoal({
        employeeId: user.employeeId,
        title: form.title,
        category: "Business",
        description: form.description,
        target: form.target,
        dueDate: form.dueDate,
        weight: Number(form.weight) || 0,
      });
    },
    onSuccess: () => {
      toast.success("Goal added");
      setOpen(false);
      setForm({ title: "", description: "", target: "", dueDate: "", weight: "" });
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) => toast.error("Could not add goal", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });

  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});
  const updateProgress = useMutation({
    mutationFn: (vars: { goalId: string; progress: number }) => talentService.updateGoalProgress(vars.goalId, vars.progress),
    onSuccess: (_data, vars) => {
      toast.success("Progress updated");
      setProgressDrafts((prev) => ({ ...prev, [vars.goalId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) => toast.error("Could not update progress", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });
  const canEditGoal = (row: Goal) => {
    if (canManageAny) return true;
    if (role === "manager") return Boolean(row.employeeId) && row.employeeId !== (user.employeeId ?? user.id);
    return false;
  };

  const atRisk = (goals.data ?? []).filter((goal) => goal.status === "at-risk" || goal.status === "delayed").length;

  const columns = useMemo<Column<Goal>[]>(
    () => [
      {
        key: "goal",
        header: "Goal",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.employeeName} · {row.category}
            </p>
          </div>
        ),
      },
      {
        key: "progress",
        header: "Progress",
        cell: (row) => (
          <div className="min-w-[140px] space-y-1">
            <div className="flex justify-between text-xs">
              <span>{percent(row.progress)}</span>
              <span className="text-muted-foreground">Weight {row.weight}%</span>
            </div>
            <Progress value={row.progress} className="h-1.5" />
            {canEditGoal(row) ? (
              <form
                className="flex items-center gap-1.5 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const raw = progressDrafts[row.id];
                  if (raw === undefined || raw === "") return;
                  updateProgress.mutate({ goalId: row.id, progress: Number(raw) });
                }}
              >
                <Input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="Set %"
                  value={progressDrafts[row.id] ?? ""}
                  onChange={(e) => setProgressDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  className="h-7 w-20 text-xs"
                />
                <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={updateProgress.isPending}>
                  Update
                </Button>
              </form>
            ) : null}
          </div>
        ),
      },
      {
        key: "due",
        header: "Due",
        cell: (row) => shortDate(row.dueDate),
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [progressDrafts, updateProgress, canEditGoal],
  );

  const visible = goals.data ?? [];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Growth"
        title={isSelfService ? "My goals" : "Goals & OKRs"}
        description="Track objectives, weights and completion across the organisation."
        actions={
          <Button onClick={() => setOpen(true)} disabled={role !== "manager" && role !== "employee"}>
            <Plus className="size-4" /> Add goal
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active goals" value={String(visible.length)} icon={Target} />
        <StatCard label="At risk / delayed" value={String(atRisk)} tone={atRisk > 0 ? "warning" : "neutral"} />
      </div>

      {!isSelfService ? (
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search goals by title, employee or category…"
          status={status}
          onStatusChange={setStatus}
          statusOptions={[
                  { value: "all", label: "All status" },
            { value: "on-track", label: "On track" },
            { value: "at-risk", label: "At risk" },
            { value: "delayed", label: "Delayed" },
            { value: "completed", label: "Completed" },
          ]}
        />
      ) : null}

      {goals.isLoading ? (
        <TableSkeleton />
      ) : goals.isError ? (
        <ErrorState onRetry={() => goals.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState title="No goals yet" description="Goals assigned to you will show up here." icon={Target} />
      ) : (
        <DataTable columns={columns} data={visible} rowKey={(row) => row.id} />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add goal</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <Label>Target</Label>
              <Input placeholder="e.g. 12 deals, 2.0s LCP" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due date</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
              <div>
                <Label>Weight</Label>
                <Input type="number" min="0" max="100" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => addGoal.mutate()} disabled={addGoal.isPending}>
              {addGoal.isPending ? "Saving…" : "Add goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
