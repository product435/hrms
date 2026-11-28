import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { DateRangeFilter, type DateRange } from "@/components/common/DateRangeFilter";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { IconAction } from "@/components/common/IconAction";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const GOAL_STATUS_OPTIONS: Array<{ value: Goal["status"]; label: string }> = [
  { value: "on-track", label: "On track" },
  { value: "at-risk", label: "At risk" },
  { value: "delayed", label: "Delayed" },
  { value: "completed", label: "Completed" },
];

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
  // Set when the open form dialog is editing an existing self-created goal
  // instead of creating a new one -- same fields/layout, different submit.
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    target: "",
    dueDate: "",
    weight: "",
    kraId: "",
  });
  const [dueDateRange, setDueDateRange] = useState<DateRange>({ from: "", to: "" });
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
      if (editingGoalId) {
        return talentService.updateOwnGoal(editingGoalId, {
          title: form.title,
          description: form.description,
          target: form.target,
          dueDate: form.dueDate,
          weight,
          kraId: form.kraId || null,
        });
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
      toast.success(editingGoalId ? "Goal updated" : "Goal added");
      setOpen(false);
      setEditingGoalId(null);
      setForm({ title: "", description: "", target: "", dueDate: "", weight: "", kraId: "" });
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) =>
      toast.error(editingGoalId ? "Could not update goal" : "Could not add goal", {
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

  // Employee's own status change, including Completed -- separate from
  // submitProgress (progress/remarks only) and from reviewGoal (which
  // stays the only path for a manager/admin/HR to change someone else's
  // goal's status).
  const submitStatus = useMutation({
    mutationFn: (vars: { goalId: string; status: Goal["status"] }) =>
      talentService.submitOwnGoalStatus(vars.goalId, vars.status),
    onSuccess: () => {
      toast.success("Status updated");
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) =>
      toast.error("Could not update status", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const [deleteDialog, setDeleteDialog] = useState<{ goalId: string; title: string } | null>(null);
  const deleteGoalMutation = useMutation({
    mutationFn: (goalId: string) => talentService.deleteGoal(goalId),
    onSuccess: () => {
      toast.success("Goal deleted");
      setDeleteDialog(null);
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) =>
      toast.error("Could not delete goal", {
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
          <div className="flex min-w-0 items-start justify-between gap-2">
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
            {/* My Goals only -- the admin Goals & OKRs page is unchanged. */}
            {isSelfService && canEditGoal(row) ? (
              <IconAction
                label="Edit goal"
                variant="ghost"
                onClick={() => {
                  setEditingGoalId(row.id);
                  setForm({
                    title: row.title,
                    description: row.description ?? "",
                    target: row.target ?? "",
                    dueDate: row.dueDate ?? "",
                    weight: String(row.weight),
                    kraId: row.kraId ?? "",
                  });
                  setOpen(true);
                }}
              >
                <Pencil />
              </IconAction>
            ) : null}
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
          const openReview = () => {
            setReviewDialog({ goalId: row.id, title: row.title });
            setReviewStatus(row.status);
            setReviewReason("");
            setReviewDescription(row.description ?? "");
            setReviewTarget(row.target ?? "");
            setReviewDueDate(row.dueDate ?? "");
            setReviewProgress("");
          };
          const canEditOwnStatus = canEditGoal(row) && row.status !== "completed";
          const canReviewRow = canReview(row);
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <StatusBadge status={label} {...(tone ? { tone } : {})} />
                {canEditOwnStatus ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label="Change status"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {GOAL_STATUS_OPTIONS.map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          disabled={option.value === row.status || submitStatus.isPending}
                          onClick={() => submitStatus.mutate({ goalId: row.id, status: option.value })}
                        >
                          {option.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {/* Admin/HR/reviewer pencil opens the SAME review_goal()-backed
                    Review dialog, pre-filled -- a required reason still
                    applies, same as the Review button; no separate
                    no-reason status bypass. */}
                {canReviewRow ? (
                  <IconAction label="Change status" variant="ghost" className="size-6" onClick={openReview}>
                    <Pencil className="size-3.5" />
                  </IconAction>
                ) : null}
              </div>
              {row.managerReviewReason ? (
                <p
                  className="max-w-40 truncate text-xs text-muted-foreground"
                  title={row.managerReviewReason}
                >
                  Reviewer: {row.managerReviewReason}
                </p>
              ) : null}
              {canReviewRow ? (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={openReview}>
                    Review
                  </Button>
                  {canManageAny ? (
                    <IconAction
                      label="Delete goal"
                      variant="ghost"
                      className="size-6"
                      onClick={() => setDeleteDialog({ goalId: row.id, title: row.title })}
                    >
                      <Trash2 className="size-3.5" />
                    </IconAction>
                  ) : null}
                </div>
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
    submitStatus,
    canManageAny,
    isLead,
    isSelfService,
    myEmployeeId,
    today,
  ]);

  // My Goals only -- Both set = only due dates in the range; only From or
  // only To = that side open-ended; the admin Goals & OKRs page is unaffected.
  const visible = isSelfService
    ? data.filter((goal) => {
        if (dueDateRange.from && (!goal.dueDate || goal.dueDate < dueDateRange.from)) return false;
        if (dueDateRange.to && (!goal.dueDate || goal.dueDate > dueDateRange.to)) return false;
        return true;
      })
    : data;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Growth"
        title={isSelfService ? "My goals" : "Goals & OKRs"}
        description="Track objectives, weights and completion across the organisation."
        actions={
          <Button
            onClick={() => {
              setEditingGoalId(null);
              setForm({
                title: "",
                description: "",
                target: "",
                dueDate: "",
                weight: "",
                kraId: "",
              });
              setOpen(true);
            }}
            disabled={!isLead && role !== "employee"}
          >
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
      ) : (
        <DateRangeFilter
          from={dueDateRange.from}
          to={dueDateRange.to}
          onApply={(from, to) => setDueDateRange({ from, to })}
          onClear={() => setDueDateRange({ from: "", to: "" })}
        />
      )}

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
            <DialogTitle>{editingGoalId ? "Edit goal" : "Add goal"}</DialogTitle>
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
              {addGoal.isPending ? "Saving…" : editingGoalId ? "Save changes" : "Add goal"}
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

      <AlertDialog
        open={deleteDialog !== null}
        onOpenChange={(open) => !open && !deleteGoalMutation.isPending && setDeleteDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteDialog?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the goal. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGoalMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteGoalMutation.isPending}
              onClick={() => deleteDialog && deleteGoalMutation.mutate(deleteDialog.goalId)}
            >
              {deleteGoalMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
