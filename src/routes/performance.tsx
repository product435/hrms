import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartBar, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireAuthForPath } from "@/lib/auth-guard";
import { talentService } from "@/services/talentService";
import { employeeService } from "@/services/employeeService";
import { useSession } from "@/hooks/useSession";
import type { PerformanceReview } from "@/types";

// Single source of truth for "not submitted" vs. a genuine 0 rating --
// null/undefined render as "Pending", a real number (including 0) never does.
const fmtScore = (v: number | null | undefined) => (v != null ? v.toFixed(1) : "Pending");

export const Route = createFileRoute("/performance")({
  beforeLoad: () => requireAuthForPath("/performance"),
  head: () => ({
    meta: [{ title: "Performance reviews · TeamNest" }],
  }),
  component: PerformancePage,
});

function PerformancePage() {
  const { role, user } = useSession();
  const isAdmin = role === "admin" || role === "hr";
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ["performance-reviews", role, user.employeeId],
    queryFn: () => talentService.reviews(),
  });

  // RLS already scopes reviews.data correctly per role (self_select for
  // employee, self_select + manager_view_team for manager, admin_hr_all for
  // admin/hr) -- no client-side filtering by employee/manager needed here.
  const data = reviews.data ?? [];
  const distinctCycles = new Set(data.map((r) => r.cycle).filter(Boolean));
  const activeCycles = new Set(
    data.filter((r) => r.status !== "completed" && r.status !== "closed").map((r) => r.cycle).filter(Boolean),
  );
  const inProgress = data.filter((row) => row.status === "in-progress").length;
  const completed = data.filter((row) => row.status === "closed" || row.status === "completed").length;

  const [cycleOpen, setCycleOpen] = useState(false);
  const [cycleName, setCycleName] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const employees = useQuery({
    queryKey: ["employees", "all-for-cycle"],
    queryFn: () => employeeService.list(),
    enabled: cycleOpen,
  });
  const createCycle = useMutation({
    mutationFn: () => talentService.createReviewCycle({ cycleName, employeeIds: [...selectedEmployees] }),
    onSuccess: () => {
      toast.success("Review cycle created");
      setCycleOpen(false);
      setCycleName("");
      setSelectedEmployees(new Set());
      void queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
    },
    onError: (e) => toast.error("Could not create cycle", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const [scoreDialog, setScoreDialog] = useState<{ reviewId: string; mode: "self" | "manager" } | null>(null);
  const [scoreValue, setScoreValue] = useState("");
  const [feedbackValue, setFeedbackValue] = useState("");
  const submitSelf = useMutation({
    mutationFn: () =>
      talentService.submitSelfReview(scoreDialog!.reviewId, { selfRating: Number(scoreValue), feedback: feedbackValue }),
    onSuccess: () => {
      toast.success("Self review submitted");
      setScoreDialog(null);
      setScoreValue("");
      setFeedbackValue("");
      void queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
    },
    onError: (e) => toast.error("Could not submit self review", { description: e instanceof Error ? e.message : "Try again." }),
  });
  const submitManager = useMutation({
    mutationFn: () =>
      talentService.submitManagerReview(scoreDialog!.reviewId, { managerRating: Number(scoreValue), feedback: feedbackValue }),
    onSuccess: () => {
      toast.success("Manager review submitted");
      setScoreDialog(null);
      setScoreValue("");
      setFeedbackValue("");
      void queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
    },
    onError: (e) => toast.error("Could not submit manager review", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const columns = useMemo<Column<PerformanceReview>[]>(
    () => [
      {
        key: "employee",
        header: "Employee",
        cell: (row) => (
          <div>
            <p className="text-sm font-semibold">{row.employeeName}</p>
            <p className="text-xs text-muted-foreground">{row.cycle}</p>
          </div>
        ),
      },
      {
        key: "reviewer",
        header: "Reviewer",
        cell: (row) => row.reviewer,
      },
      {
        key: "scores",
        header: "Scores",
        cell: (row) => (
          <div className="space-y-0.5">
            <div
              className={
                row.finalRating != null
                  ? "text-base font-bold text-foreground"
                  : "text-sm font-medium text-muted-foreground"
              }
            >
              {fmtScore(row.finalRating)}
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>Self: {fmtScore(row.selfScore)}</span>
              <span>Manager: {fmtScore(row.managerScore)}</span>
            </div>
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Growth"
        title={isAdmin ? "Performance reviews" : "My performance"}
        description={
          isAdmin
            ? "Review cycles, calibration scores and submission status across teams."
            : role === "manager"
              ? "Score your direct reports and track review status for your team."
              : "Your assigned review cycle, self-score and feedback."
        }
        actions={
          isAdmin ? (
            <Button onClick={() => setCycleOpen(true)}>
              <Plus className="size-4" /> Create performance cycle
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active cycles" value={String(activeCycles.size)} icon={ChartBar} hint={`${distinctCycles.size} total`} />
        <StatCard label="In progress" value={String(inProgress)} tone="info" />
        <StatCard label="Completed" value={String(completed)} tone="success" />
      </div>

      {reviews.isLoading ? (
        <TableSkeleton />
      ) : reviews.isError ? (
        <ErrorState onRetry={() => reviews.refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No performance reviews yet"
          description={
            isAdmin
              ? "Create a review cycle to get started."
              : "You don't have a review assigned yet. Check back once HR launches a cycle."
          }
          icon={ChartBar}
        />
      ) : isAdmin ? (
        <DataTable columns={columns} data={data} rowKey={(row) => row.id} />
      ) : (
        <SectionCard
          title={role === "manager" ? "My team's reviews" : "My review"}
          description={role === "manager" ? "Enter a score for each direct report's review" : "Enter your self-assessment score"}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {data.map((row) => {
              const isOwnRow = Boolean(row.employeeId) && row.employeeId === (user.employeeId ?? user.id);
              // A manager sees both their own row (self_select) and their
              // direct reports' rows (manager_view_team) in the same list --
              // only the report rows get a manager-score action; their own
              // row gets the same self-score action an employee would get.
              const mode: "self" | "manager" | null =
                isOwnRow && row.selfScore == null
                  ? "self"
                  : !isOwnRow && role === "manager" && row.managerScore == null
                    ? "manager"
                    : null;
              const alreadyScored = isOwnRow ? row.selfScore != null : row.managerScore != null;
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {row.employeeName}
                      {isOwnRow ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.cycle} · reviewer {row.reviewer || "—"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">
                        Self:{" "}
                        <span className={row.selfScore != null ? "font-medium text-foreground" : "italic text-muted-foreground"}>
                          {fmtScore(row.selfScore)}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        Manager:{" "}
                        <span className={row.managerScore != null ? "font-medium text-foreground" : "italic text-muted-foreground"}>
                          {fmtScore(row.managerScore)}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        Final:{" "}
                        <span className={row.finalRating != null ? "font-semibold text-foreground" : "italic text-muted-foreground"}>
                          {fmtScore(row.finalRating)}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={row.status} />
                    {mode ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setScoreDialog({ reviewId: row.id, mode });
                          setScoreValue("");
                          setFeedbackValue("");
                        }}
                      >
                        {mode === "manager" ? "Enter manager score" : "Submit self score"}
                      </Button>
                    ) : alreadyScored ? (
                      <span className="text-xs text-muted-foreground">Submitted</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      <Dialog open={cycleOpen} onOpenChange={setCycleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create performance cycle</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Cycle name</Label>
              <Input placeholder="e.g. Q3-2026" value={cycleName} onChange={(e) => setCycleName(e.target.value)} />
            </div>
            <div>
              <Label>Employees</Label>
              <div className="mt-1 max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {(employees.data ?? []).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={selectedEmployees.has(e.id)}
                      onChange={(ev) => {
                        const next = new Set(selectedEmployees);
                        if (ev.target.checked) next.add(e.id);
                        else next.delete(e.id);
                        setSelectedEmployees(next);
                      }}
                    />
                    {e.firstName} {e.lastName}
                    <span className="text-xs text-muted-foreground">{e.department}</span>
                  </label>
                ))}
                {employees.isLoading ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p> : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCycleOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createCycle.mutate()} disabled={createCycle.isPending}>
              {createCycle.isPending ? "Creating…" : "Create cycle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scoreDialog !== null} onOpenChange={(v) => !v && setScoreDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{scoreDialog?.mode === "manager" ? "Enter manager score" : "Submit self score"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Score (0–5)</Label>
              <Input type="number" min="0" max="5" step="0.1" value={scoreValue} onChange={(e) => setScoreValue(e.target.value)} />
            </div>
            <div>
              <Label>Feedback</Label>
              <Textarea value={feedbackValue} onChange={(e) => setFeedbackValue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScoreDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => (scoreDialog?.mode === "manager" ? submitManager.mutate() : submitSelf.mutate())}
              disabled={
                !scoreValue ||
                Number(scoreValue) < 0 ||
                Number(scoreValue) > 5 ||
                submitSelf.isPending ||
                submitManager.isPending
              }
            >
              {submitSelf.isPending || submitManager.isPending ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
