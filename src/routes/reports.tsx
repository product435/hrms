import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Download, Users } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { CardsSkeleton, ErrorState } from "@/components/common/States";
import { AttendanceAreaChart } from "@/components/charts/AttendanceAreaChart";
import { DistributionDonut } from "@/components/charts/DistributionDonut";
import { HeadcountBarChart } from "@/components/charts/HeadcountBarChart";
import { Button } from "@/components/ui/button";
import { requireAuthForPath } from "@/lib/auth-guard";
import { compactInr, indiaDateKey, percent } from "@/lib/format";
import { buildReportsCsv, downloadReportsCsv } from "@/lib/report-export";
import { currentKraPeriod } from "@/types/kra";
import { insightsService } from "@/services/insightsService";
import {
  roleService,
  type OrgEmployeeMetric,
  type OrgMetricRow,
  type OrgPerformanceBoard,
} from "@/services/roleService";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reports")({
  beforeLoad: () => requireAuthForPath("/reports"),
  head: () => ({
    meta: [{ title: "Reports & analytics · JeeVijay HRMS" }],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const [period, setPeriod] = useState(currentKraPeriod());
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const summary = useQuery({
    queryKey: ["company-summary"],
    queryFn: () => insightsService.companySummary(),
  });
  const attendanceTrend = useQuery({
    queryKey: ["attendance-trend"],
    queryFn: () => insightsService.attendanceTrend(),
  });
  const headcountTrend = useQuery({
    queryKey: ["headcount-trend"],
    queryFn: () => insightsService.headcountTrend(),
  });
  const departments = useQuery({
    queryKey: ["department-distribution"],
    queryFn: () => insightsService.departmentDistribution(),
  });
  const leaveMix = useQuery({ queryKey: ["leave-mix"], queryFn: () => insightsService.leaveMix() });
  const board = useQuery({
    queryKey: ["org-performance", period],
    queryFn: () => roleService.performanceBoard(period),
  });

  const performanceEmployees = useMemo(() => {
    const rows = board.data?.employees ?? [];
    if (!departmentId) return rows;
    return rows.filter((row) => (row.departmentId ?? "unassigned") === departmentId);
  }, [board.data?.employees, departmentId]);

  const selectedDepartment =
    board.data?.departments.find((row) => (row.departmentId ?? "unassigned") === departmentId)
      ?.departmentName ?? null;

  const loading =
    summary.isLoading ||
    attendanceTrend.isLoading ||
    headcountTrend.isLoading ||
    departments.isLoading ||
    leaveMix.isLoading;

  const failed =
    summary.isError ||
    attendanceTrend.isError ||
    headcountTrend.isError ||
    departments.isError ||
    leaveMix.isError;

  const canExport = Boolean(summary.data) && !loading && !failed && !board.isLoading;

  const exportReport = () => {
    if (!summary.data || failed) return;
    const csv = buildReportsCsv({
      exportedOn: indiaDateKey(),
      period,
      departmentName: selectedDepartment,
      summary: {
        headcount: summary.data.headcount,
        attritionRate: summary.data.attritionRate,
        openPositions: summary.data.openPositions,
        payrollNet: summary.data.payrollNet,
      },
      attendance: attendanceTrend.data ?? [],
      headcountTrend: headcountTrend.data ?? [],
      departments: departments.data ?? [],
      leaveMix: leaveMix.data ?? [],
      performanceDepartments: board.data ? board.data.departments : null,
      performanceEmployees: board.data ? performanceEmployees : null,
    });
    downloadReportsCsv(period, csv);
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Administration"
        title="Reports & analytics"
        description="Workforce trends, department distribution, leave mix, payroll snapshots, and performance for the people you can see."
        actions={
          <Button variant="outline" onClick={exportReport} disabled={!canExport}>
            <Download className="size-4" /> Export
          </Button>
        }
      />

      {loading ? (
        <CardsSkeleton count={4} />
      ) : failed ? (
        <ErrorState
          onRetry={() => {
            summary.refetch();
            attendanceTrend.refetch();
            headcountTrend.refetch();
            departments.refetch();
            leaveMix.refetch();
          }}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Headcount" value={String(summary.data?.headcount ?? 0)} icon={Users} />
            <StatCard
              label="Attrition"
              value={
                summary.data?.attritionRate != null ? percent(summary.data.attritionRate) : "N/A"
              }
              tone="warning"
              {...(summary.data?.attritionRate == null
                ? { hint: "No active headcount yet. Exits are counted from exit date." }
                : { hint: "Trailing 12 months, counted from exit date." })}
            />
            <StatCard label="Open positions" value={String(summary.data?.openPositions ?? 0)} />
            <StatCard label="Payroll net" value={compactInr(summary.data?.payrollNet ?? 0)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Attendance trend"
              description="Daily presence over the last two weeks."
              bodyClassName="p-4"
            >
              <AttendanceAreaChart data={attendanceTrend.data ?? []} />
            </SectionCard>
            <SectionCard
              title="Headcount movement"
              description="Joiners vs exits by month."
              bodyClassName="p-4"
            >
              <HeadcountBarChart data={headcountTrend.data ?? []} />
            </SectionCard>
            <SectionCard
              title="Department distribution"
              description="Current headcount by department."
              bodyClassName="p-4"
            >
              <DistributionDonut data={departments.data ?? []} />
            </SectionCard>
            <SectionCard
              title="Leave mix"
              description="Approved leave days by type."
              bodyClassName="p-4"
            >
              <DistributionDonut data={leaveMix.data ?? []} />
            </SectionCard>
          </div>
        </>
      )}

      <OrgPerformance
        period={period}
        departmentId={departmentId}
        employees={performanceEmployees}
        board={board}
        onPeriodChange={(next) => {
          setDepartmentId(null);
          setPeriod(next);
        }}
        onDepartmentChange={setDepartmentId}
      />
    </AppLayout>
  );
}

function scoreText(value: number | null) {
  return value == null ? "—" : value.toFixed(1);
}

function rateText(value: number | null) {
  return value == null ? "—" : percent(value);
}

function OrgPerformance({
  period,
  departmentId,
  employees,
  board,
  onPeriodChange,
  onDepartmentChange,
}: {
  period: string;
  departmentId: string | null;
  employees: OrgEmployeeMetric[];
  board: UseQueryResult<OrgPerformanceBoard, Error>;
  onPeriodChange: (period: string) => void;
  onDepartmentChange: (departmentId: string | null) => void;
}) {
  const ranked = useMemo(() => {
    const rated = employees.filter((row) => row.performanceIndex != null);
    const byScore = (left: OrgEmployeeMetric, right: OrgEmployeeMetric) =>
      (right.performanceIndex ?? 0) - (left.performanceIndex ?? 0);
    return {
      top: [...rated].sort(byScore).slice(0, 5),
      bottom: [...rated].sort((left, right) => -byScore(left, right)).slice(0, 5),
    };
  }, [employees]);

  const departmentColumns: Column<OrgMetricRow>[] = [
    {
      key: "department",
      header: "Department",
      sortable: true,
      sortValue: (row) => row.departmentName,
      cell: (row) => row.departmentName,
    },
    {
      key: "headcount",
      header: "People",
      align: "right",
      sortable: true,
      sortValue: (row) => row.headcount,
      cell: (row) => row.headcount,
    },
    {
      key: "index",
      header: "Index",
      align: "right",
      sortable: true,
      sortValue: (row) => row.performanceIndex,
      cell: (row) => scoreText(row.performanceIndex),
    },
    {
      key: "attendance",
      header: "Attendance",
      align: "right",
      sortable: true,
      sortValue: (row) => row.attendancePercent,
      cell: (row) => rateText(row.attendancePercent),
    },
    {
      key: "dwr",
      header: "DWR compliance",
      align: "right",
      sortable: true,
      sortValue: (row) => row.dwrCompliance,
      cell: (row) => rateText(row.dwrCompliance),
    },
    {
      key: "tasks",
      header: "Task completion",
      align: "right",
      sortable: true,
      sortValue: (row) => row.taskCompletion,
      cell: (row) => rateText(row.taskCompletion),
    },
  ];

  const employeeColumns: Column<OrgEmployeeMetric>[] = [
    {
      key: "name",
      header: "Employee",
      cell: (row) => (
        <Link
          to="/employees/$employeeId"
          params={{ employeeId: row.employeeId }}
          search={{ tab: "performance" }}
          className="font-medium text-primary hover:underline"
        >
          {row.employeeName}
        </Link>
      ),
    },
    { key: "department", header: "Department", cell: (row) => row.departmentName },
    {
      key: "index",
      header: "Index",
      align: "right",
      sortValue: (row) => row.performanceIndex,
      cell: (row) => scoreText(row.performanceIndex),
    },
    {
      key: "attendance",
      header: "Attendance",
      align: "right",
      cell: (row) => rateText(row.attendancePercent),
    },
    {
      key: "dwr",
      header: "DWR",
      align: "right",
      cell: (row) => rateText(row.dwrCompliance),
    },
    {
      key: "tasks",
      header: "Tasks",
      align: "right",
      cell: (row) => rateText(row.taskCompletion),
    },
  ];

  const selectedName =
    board.data?.departments.find((row) => (row.departmentId ?? "unassigned") === departmentId)
      ?.departmentName ?? null;

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Org performance</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Super Admin and HR see the organization. A department head sees their department, and a
            team lead sees direct reports. Blank cells mean there is nothing to measure yet.
          </p>
        </div>
        <div>
          <Label htmlFor="performance-period">Month</Label>
          <Input
            id="performance-period"
            type="month"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value || currentKraPeriod())}
            className="mt-1.5 w-40"
          />
        </div>
      </div>

      {board.isLoading ? (
        <CardsSkeleton count={2} />
      ) : board.isError ? (
        <ErrorState
          message={board.error instanceof Error ? board.error.message : undefined}
          onRetry={() => void board.refetch()}
        />
      ) : board.data ? (
        <>
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">Department comparison</h3>
              <p className="text-xs text-muted-foreground">
                Average performance index, attendance, daily work reports, and tasks due this month.
                Select a department to see its people.
              </p>
            </div>
            <DataTable
              columns={departmentColumns}
              rows={board.data.departments}
              rowKey={(row) => row.departmentId ?? "unassigned"}
              onRowClick={(row) => onDepartmentChange(row.departmentId ?? "unassigned")}
              emptyTitle="No people in this view"
              emptyDescription="Performance figures appear when employees you can see have a record for this month."
              pageSize={0}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {selectedName
                ? `Showing people in ${selectedName}.`
                : "Highest and lowest performance indexes."}
            </p>
            {selectedName ? (
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline"
                onClick={() => onDepartmentChange(null)}
              >
                Show every department
              </button>
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Top performers</h3>
                <p className="text-xs text-muted-foreground">Highest index this month.</p>
              </div>
              <DataTable
                columns={employeeColumns}
                rows={ranked.top}
                rowKey={(row) => row.employeeId}
                emptyTitle="No rated employees"
                emptyDescription="An index appears after KPI scores exist for the month."
                pageSize={0}
              />
            </div>
            <div className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Needs attention</h3>
                <p className="text-xs text-muted-foreground">Lowest index this month.</p>
              </div>
              <DataTable
                columns={employeeColumns}
                rows={ranked.bottom}
                rowKey={(row) => `bottom-${row.employeeId}`}
                emptyTitle="No rated employees"
                emptyDescription="An index appears after KPI scores exist for the month."
                pageSize={0}
              />
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
