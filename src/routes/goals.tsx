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
import { usePermissions } from "@/hooks/usePermissions";
import { talentService } from "@/services/talentService";
import { kraService } from "@/services/kraService";
import { currentKraPeriod } from "@/types/kra";
import type { Goal } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const fieldClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Display-only: a goal whose due date has passed and is not complete
 * shows "Overdue" instead of whatever status is stored, without changing
 * the stored value (approved approach -- a DB trigger that rewrites
 * status on every consumer was considered and rejected as higher risk).
 */
function isOverdue(goal: Goal, today: string) {
  return goal.status !== "completed" && Boolean(goal.dueDate) && goal.dueDate < today;
}

function displayStatus(goal: Goal, today: string): { label: string; tone?: "danger" } {
  if (isOverdue(goal, today)) return { label: "overdue", tone: "danger" };
  return { label: goal.status };
}

function GoalsPage() {
  const { role, user, isLoading, isLead } = usePermissions();
  const isSelfService = role === "employee";
  const canManageAny = role === "admin" || role === "hr";
  const myEmployeeId = user.employeeId ?? user.id;
  const today = new Date().toISOString().slice(0, 10);
  const period = currentKraPeriod();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    target: "",
    dueDate: "",
    weight: "",
    kraId: "",
  });
  const queryClient = useQueryClient();

  const goals = useQuery({
    queryKey: ["goals", isSelfService ? myEmployeeId : "all", search, status],
    queryFn: () =>
      isSelfService ? talentService.goalsOf(myEmployeeId) : talentService.goals({ search, status }),
    enabled: !isLoading,
  });

  // KRAs actually assigned to the current user this month, for the
  // "Link to an existing assigned KRA" field -- never every template in
  // the org (task requirement #2).
  const myKras = useQuery({
    queryKey: ["my-resolved-kras", myEmployeeId, period],
    queryFn: () => kraService.resolvedTemplates(myEmployeeId, period),
    enabled: Boolean(myEmployeeId) && (isLead || role === "employee"),
  });

  const addGoal = useMutation({
    mutationFn: () => {
      if (!(isLead || role === "employee") || !user.employeeId)
        throw new Error("Your employee profile is not linked.");
      if (!form.title.trim()) throw new Error("Goal title is required.");
      const rawWeight = form.weight.trim();
      const weight = Number(rawWeight);
      if (rawWeight === "" || !Number.isFinite(weight) || weight < 0 || weight > 100) {
        throw new Error("Weight must be between 0 and 100.");
      }
      return talentService.createGoal({
        employeeId: user.employeeId,
        title: form.title,
        category: "Business",
        description: form.description,
        target: form.target,
        dueDate: form.dueDate,
        weight,
        kraId: form.kraId || null,
      });
    },
    onSuccess: () => {
      toast.success("Goal added");
      setOpen(false);
      setForm({ title: "", description: "", target: "", dueDate: "", weight: "", kraId: "" });
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) =>
      toast.error("Could not add goal", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});
  const [remarksDrafts, setRemarksDrafts] = useState<Record<string, string>>({});

  // Employee's own-goal update path (new RPC -- RLS has no self-update
  // policy for goals, so this is the only way an employee can edit their
  // own progress/remarks).
  const submitProgress = useMutation({
    mutationFn: (vars: { goalId: string; progress?: number; remarks?: string }) =>
      talentService.submitGoalProgress(vars.goalId, {
        progress: vars.progress,
        remarks: vars.remarks ?? null,
      }),
    onSuccess: (_data, vars) => {
      toast.success("Progress updated");
      setProgressDrafts((prev) => ({ ...prev, [vars.goalId]: "" }));
      setRemarksDrafts((prev) => ({ ...prev, [vars.goalId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) =>
      toast.error("Could not update progress", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const [reviewDialog, setReviewDialog] = useState<{ goalId: string; title: string } | null>(null);
  const [reviewStatus, setReviewStatus] = useState<Goal["status"]>("on-track");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewDescription, setReviewDescription] = useState("");
  const [reviewTarget, setReviewTarget] = useState("");
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [reviewProgress, setReviewProgress] = useState("");
  const reviewGoal = useMutation({
    mutationFn: () => {
      const progress = reviewProgress.trim();
      if (progress && (!Number.isFinite(Number(progress)) || Number(progress) < 0 || Number(progress) > 100)) {
        throw new Error("Progress must be between 0 and 100.");
      }
      return talentService.reviewGoal(reviewDialog!.goalId, {
        status: reviewStatus,
        reason: reviewReason,
        description: reviewDescription || null,
        target: reviewTarget || null,
        dueDate: reviewDueDate || null,
        progress: progress ? Number(progress) : null,
      });
    },
    onSuccess: () => {
      toast.success("Goal reviewed");
      setReviewDialog(null);
      setReviewReason("");
      setReviewDescription("");
      setReviewTarget("");
      setReviewDueDate("");
      setReviewProgress("");
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) =>
      toast.error("Could not review goal", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const data = goals.data ?? [];
  const atRisk = data.filter(
    (goal) => goal.status === "at-risk" || goal.status === "delayed" || isOverdue(goal, today),
  ).length;

  const columns = useMemo<Column<Goal>[]>(() => {
    const isOwnGoal = (row: Goal) => Boolean(row.employeeId) && row.employeeId === myEmployeeId;
    const canEditGoal = (row: Goal) => isOwnGoal(row);
    const canReview = (row: Goal) => (canManageAny || isLead) && !isOwnGoal(row);
    return [
      {
        key: "goal",
        header: "Goal",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.employeeName} · {row.category}
            </p>
            {row.kraName ? (
              <p className="truncate text-xs text-muted-foreground">KRA: {row.kraName}</p>
            ) : (
              <p className="truncate text-xs italic text-muted-foreground">No matching KRA</p>
            )}
          </div>
        ),
      },
      {
        key: "progress",
        header: "Progress",
        cell: (row) => (
          <div className="min-w-35 space-y-1">
            <div className="flex justify-between text-xs">
              <span>{percent(row.progress)}</span>
              <span className="text-muted-foreground">Weight {row.weight}%</span>
            </div>
            <Progress value={row.progress} className="h-1.5" />
            {row.progressRemarks ? (
              <p className="truncate text-xs text-muted-foreground" title={row.progressRemarks}>
                {row.progressRemarks}
              </p>
            ) : null}
            {row.status === "completed" && (canEditGoal(row) || canReview(row)) ? (
              <p className="text-xs italic text-muted-foreground">
                Marked completed{row.managerReviewReason ? ` — ${row.managerReviewReason}` : ""}.
                Ask your reviewer to reopen it to make further changes.
              </p>
            ) : canEditGoal(row) ? (
              <form
                className="flex flex-col gap-1.5 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const raw = progressDrafts[row.id];
                  const remarks = remarksDrafts[row.id]?.trim();
                  if ((raw === undefined || raw === "") && !remarks) return;
                  const progress = raw === undefined || raw === "" ? undefined : Number(raw);
                  if (progress != null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) return;
                  submitProgress.mutate({
                    goalId: row.id,
                    ...(progress !== undefined ? { progress } : {}),
                    ...(remarks ? { remarks } : {}),
                  });
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Set %"
                    value={progressDrafts[row.id] ?? ""}
                    onChange={(e) =>
                      setProgressDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                    className="h-7 w-20 text-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={submitProgress.isPending}
                  >
                    Update
                  </Button>
                </div>
                {isOwnGoal(row) ? (
                  <Input
                    placeholder="Progress remarks (optional)"
                    value={remarksDrafts[row.id] ?? ""}
                    onChange={(e) =>
                      setRemarksDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                    className="h-7 text-xs"
                  />
                ) : null}
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
        cell: (row) => {
          const { label, tone } = displayStatus(row, today);
          return (
            <div className="space-y-1">
              <StatusBadge status={label} {...(tone ? { tone } : {})} />
              {row.managerReviewReason ? (
                <p
                  className="max-w-40 truncate text-xs text-muted-foreground"
                  title={row.managerReviewReason}
                >
                  Reviewer: {row.managerReviewReason}
                </p>
              ) : null}
              {canReview(row) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs"
                  onClick={() => {
                    setReviewDialog({ goalId: row.id, title: row.title });
                    setReviewStatus(row.status);
                    setReviewReason("");
                    setReviewDescription(row.description ?? "");
                    setReviewTarget(row.target ?? "");
                    setReviewDueDate(row.dueDate ?? "");
                    setReviewProgress("");
                  }}
                >
                  Review
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ];
  }, [
    progressDrafts,
    remarksDrafts,
    submitProgress,
    canManageAny,
    isLead,
    myEmployeeId,
    today,
  ]);

  const visible = data;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Growth"
        title={isSelfService ? "My goals" : "Goals & OKRs"}
        description="Track objectives, weights and completion across the organisation."
        actions={
          <Button onClick={() => setOpen(true)} disabled={!isLead && role !== "employee"}>
            <Plus className="size-4" /> Add goal
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active goals" value={String(visible.length)} icon={Target} />
        <StatCard
          label="At risk / delayed / overdue"
          value={String(atRisk)}
          tone={atRisk > 0 ? "warning" : "neutral"}
        />
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
        <EmptyState
          title="No goals yet"
          description="Goals assigned to you will show up here."
          icon={Target}
        />
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
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <Label>Target</Label>
              <Input
                placeholder="e.g. 12 deals, 2.0s LCP"
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
              />
            </div>
            <div>
              <Label>Link to KRA (optional)</Label>
              <select
                className={fieldClass}
                value={form.kraId}
                onChange={(e) => setForm({ ...form, kraId: e.target.value })}
              >
                <option value="">No matching KRA</option>
                {(myKras.data ?? []).map((kra) => (
                  <option key={kra.id} value={kra.id}>
                    {kra.name}
                  </option>
                ))}
              </select>
              {myKras.data && myKras.data.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No KRA is assigned to you this month yet.
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
              <div>
                <Label>Weight</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                />
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

      <Dialog open={reviewDialog !== null} onOpenChange={(v) => !v && setReviewDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review goal{reviewDialog ? `: ${reviewDialog.title}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Status</Label>
              <select
                className={fieldClass}
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value as Goal["status"])}
              >
                <option value="on-track">On track</option>
                <option value="at-risk">At risk</option>
                <option value="delayed">Delayed</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <Label>Reason for this review *</Label>
              <Textarea
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                placeholder="Required whenever a reviewer changes this goal."
              />
            </div>
            <div>
              <Label>Progress override (optional)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={reviewProgress}
                onChange={(e) => setReviewProgress(e.target.value)}
                placeholder="Leave blank to preserve current progress"
              />
            </div>
            <div>
              <Label>Description (editable by the reviewer)</Label>
              <Textarea
                value={reviewDescription}
                onChange={(e) => setReviewDescription(e.target.value)}
              />
            </div>
            <div>
              <Label>Target (editable by the reviewer)</Label>
              <Input value={reviewTarget} onChange={(e) => setReviewTarget(e.target.value)} />
            </div>
            <div>
              <Label>Due date (editable by the reviewer)</Label>
              <Input
                type="date"
                value={reviewDueDate}
                onChange={(e) => setReviewDueDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => reviewGoal.mutate()}
              disabled={!reviewReason.trim() || reviewGoal.isPending}
            >
              {reviewGoal.isPending ? "Saving…" : "Save review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
