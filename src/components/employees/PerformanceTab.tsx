import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { percent, shortDate } from "@/lib/format";
import { WorkReportDetailDialog } from "@/components/work/WorkReportDetail";
import { attendanceService } from "@/services/attendanceService";
import { kraService } from "@/services/kraService";
import { roleService, type EmployeeWorkSnapshot } from "@/services/roleService";
import type { Goal, PerformanceReview } from "@/types";
import { currentKraPeriod } from "@/types/kra";
import type { DailyWorkReport } from "@/types/work";

function monthBounds(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return { from: `${period}-01`, to: `${period}-28` };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

function scoreText(value: number | null | undefined) {
  return value == null || Number.isNaN(value) ? "Not rated" : value.toFixed(1);
}

function toDetailReport(
  employeeId: string,
  report: EmployeeWorkSnapshot["reports"][number],
): DailyWorkReport {
  return {
    id: report.id,
    employeeId,
    employeeName: "",
    reportDate: report.date,
    status: report.status,
    submittedAt: null,
    totalHours: report.hours ?? 0,
    blockers: report.blockers,
    planForTomorrow: report.planForTomorrow,
    summaryHtml: report.summaryHtml,
    reviewStatus: report.reviewStatus,
    leadRating: report.rating,
    leadRemarks: report.leadRemarks,
    reviewedBy: null,
    reviewedAt: null,
    escalated: false,
    reopenReason: "",
    waiverReason: "",
    items: report.items,
  };
}

export function PerformanceTab({
  employeeId,
  goals,
  reviews,
}: {
  employeeId: string;
  goals: Goal[] | undefined;
  reviews: PerformanceReview[] | undefined;
}) {
  const [period, setPeriod] = useState(currentKraPeriod());
  const [openReport, setOpenReport] = useState<DailyWorkReport | null>(null);
  const bounds = monthBounds(period);
  const attendance = useQuery({
    queryKey: ["employee-attendance-month", employeeId, period],
    queryFn: () => attendanceService.list({ employeeId, from: bounds.from, to: bounds.to }),
  });
  const work = useQuery({
    queryKey: ["employee-work-snapshot", employeeId],
    queryFn: () => roleService.employeeWork(employeeId),
  });
  const scores = useQuery({
    queryKey: ["employee-kpi", employeeId, period],
    queryFn: () => kraService.scoreGrid(period),
  });
  const trend = useQuery({
    queryKey: ["employee-index-trend", employeeId, period],
    queryFn: () => kraService.trend(employeeId, period, 6),
  });

  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    (attendance.data ?? []).forEach((record) => {
      const status = record.status || "unmarked";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    });
    return [...counts.entries()];
  }, [attendance.data]);
  const kpiRows = (scores.data ?? []).filter((row) => row.employeeId === employeeId);
  const reports = work.data?.reports;
  const tasks = work.data?.tasks;
  const trendPoints = trend.data;

  return (
    <TabsContent value="performance" className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">This month</h2>
          <p className="text-sm text-muted-foreground">
            Attendance, work reports, open tasks, and KPI scores.
          </p>
        </div>
        <div>
          <Label htmlFor="profile-performance-period">Month</Label>
          <Input
            id="profile-performance-period"
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value || currentKraPeriod())}
            className="mt-1.5 w-40"
          />
        </div>
      </div>

      <SectionCard
        title="Attendance"
        description="Recorded days in the selected month."
        bodyClassName="p-5"
      >
        {attendance.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading attendance…</p>
        ) : attendance.isError ? (
          <p className="text-sm text-destructive">
            {attendance.error instanceof Error
              ? attendance.error.message
              : "Attendance could not be loaded."}
          </p>
        ) : (attendance.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance records for this month.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {summary.map(([status, count]) => (
              <div key={status} className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {status}
                </p>
                <p className="font-display text-2xl font-bold">{count}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Recent work reports" bodyClassName="p-0">
          {work.isLoading ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">Loading reports…</p>
          ) : work.isError ? (
            <p className="px-5 py-8 text-sm text-destructive">
              {work.error instanceof Error
                ? work.error.message
                : "Work reports could not be loaded."}
            </p>
          ) : !reports || reports.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No daily work reports yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {reports.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/40"
                    onClick={() => setOpenReport(toDetailReport(employeeId, report))}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{shortDate(report.date)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {report.hours == null ? "Hours not recorded" : `${report.hours}h`} · review{" "}
                        {report.reviewStatus}
                        {report.rating == null ? "" : ` · rating ${report.rating}`}
                      </p>
                    </div>
                    <StatusBadge status={report.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Open tasks" bodyClassName="p-0">
          {work.isLoading ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">Loading tasks…</p>
          ) : work.isError ? (
            <p className="px-5 py-8 text-sm text-destructive">
              {work.error instanceof Error ? work.error.message : "Tasks could not be loaded."}
            </p>
          ) : !tasks || tasks.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{task.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {task.priority}
                      {task.dueDate ? ` · due ${shortDate(task.dueDate)}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={task.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="KPI scores"
        description="Scores entered or calculated for this month."
        bodyClassName="p-0"
      >
        {scores.isLoading ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Loading KPI scores…</p>
        ) : scores.isError ? (
          <p className="px-5 py-8 text-sm text-destructive">
            {scores.error instanceof Error
              ? scores.error.message
              : "KPI scores could not be loaded."}
          </p>
        ) : kpiRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No KPI scores for this month.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {kpiRows.map((row) => (
              <li key={row.kpiDefinitionId} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.metric}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.kraName} · target{" "}
                    {row.target == null ? "—" : `${row.target}${row.unit ? ` ${row.unit}` : ""}`}
                    {" · "}actual {row.actual == null ? "—" : row.actual}
                  </p>
                </div>
                <span className="text-sm font-semibold">{scoreText(row.score)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Index trend"
        description="Last six months, through the selected month."
        bodyClassName="p-0"
      >
        {trend.isLoading ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Loading the index trend…</p>
        ) : trend.isError ? (
          <p className="px-5 py-8 text-sm text-destructive">
            {trend.error instanceof Error
              ? trend.error.message
              : "The index trend could not be loaded."}
          </p>
        ) : !trendPoints || trendPoints.every((point) => point.performanceIndex == null) ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No performance index for this period.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {trendPoints.map((point) => (
              <li key={point.period} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{point.period}</p>
                  <p className="text-xs text-muted-foreground">
                    {point.band}
                    {point.prorated ? " · pro-rated" : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold">{scoreText(point.performanceIndex)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Goals" bodyClassName="space-y-4 p-5">
        {(goals ?? []).map((goal) => (
          <div key={goal.id}>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{goal.title}</p>
              <StatusBadge status={goal.status} />
            </div>
            <Progress value={goal.progress} className="mt-2 h-2" />
            <p className="mt-1 text-xs text-muted-foreground">
              {percent(goal.progress)} · weight {goal.weight}% · due {shortDate(goal.dueDate)}
            </p>
          </div>
        ))}
        {goals?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No goals for this cycle.</p>
        ) : null}
      </SectionCard>
      <SectionCard title="Review cycles" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {(reviews ?? []).map((review) => (
            <li key={review.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{review.cycle}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Reviewer {review.reviewer} · self {review.selfScore} · manager{" "}
                  {review.managerScore}
                </p>
              </div>
              <span className="text-sm font-semibold">{review.finalRating}</span>
              <StatusBadge status={review.status} />
            </li>
          ))}
          {reviews?.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No reviews recorded.
            </li>
          ) : null}
        </ul>
      </SectionCard>
      <WorkReportDetailDialog report={openReport} readOnly onClose={() => setOpenReport(null)} />
    </TabsContent>
  );
}
