import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  AlertTriangle,
  ClipboardCheck,
  Eye,
  FileClock,
  Gauge,
  LineChart,
  Users,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { BandLabel } from "@/components/common/BandLabel";
import { IconAction } from "@/components/common/IconAction";
import { CardsSkeleton, EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { WorkReportDetailDialog } from "@/components/work/WorkReportDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { requireAuthForPath } from "@/lib/auth-guard";
import { usePermissions } from "@/hooks/usePermissions";
import { indiaDateKey, indiaDateKeyDaysAgo, shortDate } from "@/lib/format";
import {
  roleService,
  type OrgEmployeeMetric,
  type OrgPerformanceBoard,
} from "@/services/roleService";
import { kraService } from "@/services/kraService";
import { workService } from "@/services/workService";
import {
  filingRate,
  orgOverviewService,
  periodBounds,
  type WorkReportRollupRow,
} from "@/services/orgOverviewService";
import { currentKraPeriod, formatKraScore, performanceBand } from "@/types/kra";
import type { DailyWorkReport, DwrStatus } from "@/types/work";

/** Score as text; a dash when unscored, since the band label already says "Not rated". */
function scoreText(value: number | null | undefined) {
  return value == null ? "—" : formatKraScore(value);
}

export const Route = createFileRoute("/org-overview")({
  beforeLoad: () => requireAuthForPath("/org-overview"),
  head: () => ({
    meta: [{ title: "Org overview · JeeVijay HRMS" }],
  }),
  component: OrgOverviewPage,
});

/** One person's month: KPI metrics from the performance board + work-report counts. */
interface PersonRow {
  employeeId: string;
  name: string;
  code: string;
  department: string;
  performanceIndex: number | null;
  attendancePercent: number | null;
  dwrCompliance: number | null;
  taskCompletion: number | null;
  work: WorkReportRollupRow | null;
}

const ALL = "all";

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function average(values: (number | null | undefined)[]) {
  const present = values.filter((value): value is number => value != null);
  return present.length === 0 ? null : present.reduce((sum, v) => sum + v, 0) / present.length;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Try again.";
}

function mergePeople(metrics: OrgEmployeeMetric[], rollup: WorkReportRollupRow[]): PersonRow[] {
  const byId = new Map<string, PersonRow>();
  for (const work of rollup) {
    byId.set(work.employeeId, {
      employeeId: work.employeeId,
      name: work.employeeName,
      code: work.employeeCode,
      department: work.departmentName,
      performanceIndex: null,
      attendancePercent: null,
      dwrCompliance: null,
      taskCompletion: null,
      work,
    });
  }
  for (const metric of metrics) {
    const existing = byId.get(metric.employeeId);
    byId.set(metric.employeeId, {
      employeeId: metric.employeeId,
      name: existing?.name ?? metric.employeeName,
      code: existing?.code ?? "",
      department: metric.departmentName || existing?.department || "Unassigned",
      performanceIndex: metric.performanceIndex,
      attendancePercent: metric.attendancePercent,
      dwrCompliance: metric.dwrCompliance,
      taskCompletion: metric.taskCompletion,
      work: existing?.work ?? null,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function OrgOverviewPage() {
  const { isGeneralManager } = usePermissions();
  const [period, setPeriod] = useState(currentKraPeriod());
  const [tab, setTab] = useState("people");
  const [selected, setSelected] = useState<PersonRow | null>(null);
  const bounds = periodBounds(period);
  // Never count future days of the current month.
  const today = indiaDateKey();
  const to = bounds.to > today ? today : bounds.to;

  const board = useQuery({
    queryKey: ["org-performance", period],
    queryFn: () => roleService.performanceBoard(period),
  });
  const rollup = useQuery({
    queryKey: ["org-work-rollup", bounds.from, to],
    queryFn: () => orgOverviewService.workRollup(bounds.from, to),
  });

  const people = useMemo(
    () => mergePeople(board.data?.employees ?? [], rollup.data ?? []),
    [board.data?.employees, rollup.data],
  );

  const totals = useMemo(() => {
    const work = rollup.data ?? [];
    const sum = (pick: (row: WorkReportRollupRow) => number) =>
      work.reduce((acc, row) => acc + pick(row), 0);
    const filed = sum((row) => row.submitted + row.late);
    const missed = sum((row) => row.missed);
    return {
      people: people.length,
      avgIndex: average(people.map((row) => row.performanceIndex)),
      filingRate: filed + missed === 0 ? null : (filed / (filed + missed)) * 100,
      pendingReview: sum((row) => row.pendingReview),
      missed,
      late: sum((row) => row.late),
    };
  }, [people, rollup.data]);

  const loading = board.isLoading || rollup.isLoading;

  return (
    <AppLayout>
      <PageHeader
        eyebrow={isGeneralManager ? "General Manager" : "Leadership view"}
        title="Organisation overview"
        description="Everyone's work reports and KPIs for the month, in one place. Open a person to see their KPI breakdown and daily reports."
        actions={
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="overview-period" className="text-xs">
                Month
              </Label>
              <Input
                id="overview-period"
                type="month"
                value={period}
                max={currentKraPeriod()}
                onChange={(event) => setPeriod(event.target.value || currentKraPeriod())}
                className="mt-1 w-40"
              />
            </div>
            <Button asChild variant="outline">
              <Link to="/reports">Full analytics</Link>
            </Button>
          </div>
        }
      />

      {loading ? (
        <CardsSkeleton count={4} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="People tracked"
            value={String(totals.people)}
            icon={Users}
            tone="primary"
            hint="Active employees in the month"
          />
          <StatCard
            label="Avg performance index"
            value={scoreText(totals.avgIndex)}
            icon={Gauge}
            tone="info"
            hint={performanceBand(totals.avgIndex)}
          />
          <StatCard
            label="Report filing rate"
            value={pct(totals.filingRate)}
            icon={ClipboardCheck}
            tone="success"
            hint={`${totals.late} late · ${totals.missed} missed`}
          />
          <StatCard
            label="Awaiting lead review"
            value={String(totals.pendingReview)}
            icon={FileClock}
            tone="warning"
            hint="Submitted reports not yet reviewed"
          />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="people">People &amp; KPIs</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="reports">Work reports</TabsTrigger>
        </TabsList>

        <TabsContent value="people">
          <PeopleTable
            rows={people}
            isLoading={loading}
            isError={board.isError || rollup.isError}
            error={board.error ?? rollup.error}
            onRetry={() => {
              void board.refetch();
              void rollup.refetch();
            }}
            onOpen={setSelected}
          />
        </TabsContent>

        <TabsContent value="departments">
          <DepartmentsPanel board={board} people={people} />
        </TabsContent>

        <TabsContent value="reports">
          <ReportFeed />
        </TabsContent>
      </Tabs>

      <PersonSheet person={selected} period={period} onClose={() => setSelected(null)} />
    </AppLayout>
  );
}

function PeopleTable({
  rows,
  isLoading,
  isError,
  error,
  onRetry,
  onOpen,
}: {
  rows: PersonRow[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (row: PersonRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [band, setBand] = useState(ALL);

  const departments = useMemo(() => [...new Set(rows.map((row) => row.department))].sort(), [rows]);
  const filtered = rows.filter((row) => {
    if (department !== ALL && row.department !== department) return false;
    if (band !== ALL && performanceBand(row.performanceIndex) !== band) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return (
      row.name.toLowerCase().includes(needle) ||
      row.code.toLowerCase().includes(needle) ||
      row.department.toLowerCase().includes(needle)
    );
  });

  const columns: Column<PersonRow>[] = [
    {
      key: "name",
      header: "Employee",
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[row.code, row.department].filter(Boolean).join(" · ")}
          </p>
        </div>
      ),
    },
    {
      key: "index",
      header: "Performance",
      sortValue: (row) => row.performanceIndex,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="w-10 text-sm font-semibold tabular-nums">
            {scoreText(row.performanceIndex)}
          </span>
          <BandLabel band={performanceBand(row.performanceIndex)} />
        </div>
      ),
    },
    {
      key: "attendance",
      header: "Attendance",
      align: "right",
      sortValue: (row) => row.attendancePercent,
      cell: (row) => <span className="tabular-nums">{pct(row.attendancePercent)}</span>,
    },
    {
      key: "tasks",
      header: "Tasks done",
      align: "right",
      sortValue: (row) => row.taskCompletion,
      cell: (row) => <span className="tabular-nums">{pct(row.taskCompletion)}</span>,
    },
    {
      key: "reports",
      header: "Reports filed",
      sortValue: (row) => (row.work ? filingRate(row.work) : null),
      cell: (row) =>
        row.work ? (
          <div className="text-sm">
            <span className="font-semibold tabular-nums">{pct(filingRate(row.work))}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {row.work.submitted + row.work.late} filed
              {row.work.late ? ` · ${row.work.late} late` : ""}
              {row.work.missed ? ` · ${row.work.missed} missed` : ""}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "rating",
      header: "Lead rating",
      align: "right",
      sortValue: (row) => row.work?.avgLeadRating ?? null,
      cell: (row) =>
        row.work?.avgLeadRating != null ? (
          <span className="tabular-nums">{row.work.avgLeadRating.toFixed(1)} / 5</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "last",
      header: "Last report",
      sortValue: (row) => row.work?.lastReportDate ?? null,
      cell: (row) =>
        row.work?.lastReportDate ? (
          shortDate(row.work.lastReportDate)
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      key: "open",
      header: "",
      cell: (row) => (
        <IconAction
          label={`Open ${row.name}`}
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row);
          }}
        >
          <Eye />
        </IconAction>
      ),
    },
  ];

  if (isError) {
    return <ErrorState message={errorText(error)} onRetry={onRetry} />;
  }

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search name, code or department"
        filters={[
          {
            id: "department",
            label: "Department",
            value: department,
            onChange: setDepartment,
            options: [
              { value: ALL, label: "All departments" },
              ...departments.map((name) => ({ value: name, label: name })),
            ],
          },
          {
            id: "band",
            label: "Band",
            value: band,
            onChange: setBand,
            options: [
              { value: ALL, label: "All bands" },
              ...["Outstanding", "Exceeds", "Meets", "Needs Improvement", "Not rated"].map(
                (value) => ({ value, label: value }),
              ),
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(row) => row.employeeId}
        isLoading={isLoading}
        onRowClick={onOpen}
        pageSize={15}
        emptyTitle="No people in scope"
        emptyDescription="Active employees appear here with their KPIs and report counts."
      />
    </div>
  );
}

function DepartmentsPanel({
  board,
  people,
}: {
  board: UseQueryResult<OrgPerformanceBoard>;
  people: PersonRow[];
}) {
  const rows = useMemo(() => {
    const work = new Map<string, { filed: number; missed: number; pending: number }>();
    for (const person of people) {
      if (!person.work) continue;
      const current = work.get(person.department) ?? { filed: 0, missed: 0, pending: 0 };
      current.filed += person.work.submitted + person.work.late;
      current.missed += person.work.missed;
      current.pending += person.work.pendingReview;
      work.set(person.department, current);
    }
    return (board.data?.departments ?? []).map((department) => {
      const counts = work.get(department.departmentName) ?? { filed: 0, missed: 0, pending: 0 };
      return {
        ...department,
        filingRate:
          counts.filed + counts.missed === 0
            ? null
            : (counts.filed / (counts.filed + counts.missed)) * 100,
        pending: counts.pending,
      };
    });
  }, [board.data?.departments, people]);

  if (board.isLoading) return <TableSkeleton rows={5} columns={6} />;
  if (board.isError) {
    return <ErrorState message={errorText(board.error)} onRetry={() => void board.refetch()} />;
  }

  type DepartmentRow = (typeof rows)[number];
  const columns: Column<DepartmentRow>[] = [
    {
      key: "name",
      header: "Department",
      sortValue: (row) => row.departmentName,
      cell: (row) => <span className="font-semibold">{row.departmentName}</span>,
    },
    {
      key: "headcount",
      header: "People",
      align: "right",
      sortValue: (row) => row.headcount,
      cell: (row) => <span className="tabular-nums">{row.headcount}</span>,
    },
    {
      key: "index",
      header: "Performance",
      sortValue: (row) => row.performanceIndex,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="w-10 font-semibold tabular-nums">{scoreText(row.performanceIndex)}</span>
          <BandLabel band={performanceBand(row.performanceIndex)} />
        </div>
      ),
    },
    {
      key: "attendance",
      header: "Attendance",
      align: "right",
      sortValue: (row) => row.attendancePercent,
      cell: (row) => <span className="tabular-nums">{pct(row.attendancePercent)}</span>,
    },
    {
      key: "filing",
      header: "Reports filed",
      align: "right",
      sortValue: (row) => row.filingRate,
      cell: (row) => <span className="tabular-nums">{pct(row.filingRate)}</span>,
    },
    {
      key: "tasks",
      header: "Tasks done",
      align: "right",
      sortValue: (row) => row.taskCompletion,
      cell: (row) => <span className="tabular-nums">{pct(row.taskCompletion)}</span>,
    },
    {
      key: "pending",
      header: "Awaiting review",
      align: "right",
      sortValue: (row) => row.pending,
      cell: (row) =>
        row.pending > 0 ? (
          <StatusBadge status={`${row.pending} pending`} tone="warning" />
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
  ];

  const top = board.data?.top ?? [];
  const bottom = board.data?.bottom ?? [];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.departmentId ?? row.departmentName}
        pageSize={0}
        emptyTitle="No departments"
        emptyDescription="Department KPIs appear once people are assigned to departments."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top performers" description="Highest performance index this month">
          <RankList rows={top} empty="No scored employees yet." />
        </SectionCard>
        <SectionCard
          title="Needs attention"
          description="Lowest performance index this month"
          action={<AlertTriangle className="size-4 text-warning" />}
        >
          <RankList rows={bottom} empty="No scored employees yet." />
        </SectionCard>
      </div>
    </div>
  );
}

function RankList({ rows, empty }: { rows: OrgEmployeeMetric[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="space-y-2">
      {rows.map((row, index) => (
        <li key={row.employeeId} className="flex items-center gap-3">
          <span className="w-5 text-xs font-semibold text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{row.employeeName}</p>
            <p className="truncate text-xs text-muted-foreground">{row.departmentName}</p>
          </div>
          <span className="text-sm font-semibold tabular-nums">
            {scoreText(row.performanceIndex)}
          </span>
          <BandLabel band={performanceBand(row.performanceIndex)} />
        </li>
      ))}
    </ol>
  );
}

const REPORT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: "All statuses" },
  { value: "submitted", label: "Submitted" },
  { value: "late", label: "Late" },
  { value: "missed", label: "Missed" },
  { value: "draft", label: "Draft" },
];

function ReportFeed() {
  const [from, setFrom] = useState(indiaDateKeyDaysAgo(6));
  const [to, setTo] = useState(indiaDateKey());
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<DailyWorkReport | null>(null);
  const validRange = Boolean(from && to && from <= to);

  const reports = useQuery({
    queryKey: ["org-reports", from, to],
    queryFn: () => workService.listReportsBetween(from, to),
    enabled: validRange,
  });

  const rows = (reports.data ?? []).filter((report) => {
    if (status !== ALL && report.status !== (status as DwrStatus)) return false;
    if (!search.trim()) return true;
    return report.employeeName.toLowerCase().includes(search.trim().toLowerCase());
  });

  const columns: Column<DailyWorkReport>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (row) => row.reportDate,
      cell: (row) => shortDate(row.reportDate),
    },
    {
      key: "employee",
      header: "Employee",
      sortValue: (row) => row.employeeName,
      cell: (row) => <span className="font-semibold">{row.employeeName || "Employee"}</span>,
    },
    {
      key: "status",
      header: "Report",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "hours",
      header: "Hours",
      align: "right",
      sortValue: (row) => row.totalHours,
      cell: (row) => <span className="tabular-nums">{row.totalHours}h</span>,
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      cell: (row) => <span className="tabular-nums">{row.items.length}</span>,
    },
    {
      key: "review",
      header: "Review",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={row.reviewStatus} />
          {row.leadRating != null ? (
            <span className="text-xs text-muted-foreground">{row.leadRating}/5</span>
          ) : null}
          {row.escalated ? <StatusBadge status="escalated" tone="warning" /> : null}
        </div>
      ),
    },
    {
      key: "blockers",
      header: "Blockers",
      cell: (row) =>
        row.blockers ? (
          <span className="line-clamp-1 max-w-56 text-xs text-warning">{row.blockers}</span>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search employee"
        status={status}
        onStatusChange={setStatus}
        statusOptions={REPORT_STATUS_OPTIONS}
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="From date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 w-full sm:w-40"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              value={to}
              min={from}
              max={indiaDateKey()}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 w-full sm:w-40"
            />
          </div>
        }
      />
      {!validRange ? (
        <EmptyState
          title="Pick a valid range"
          description="The start date must be on or before the end date."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          isLoading={reports.isLoading}
          isError={reports.isError}
          onRetry={() => void reports.refetch()}
          onRowClick={setViewing}
          pageSize={20}
          emptyTitle="No reports in this range"
          emptyDescription="Daily work reports from everyone in your scope appear here."
        />
      )}
      <WorkReportDetailDialog report={viewing} readOnly onClose={() => setViewing(null)} />
    </div>
  );
}

function PersonSheet({
  person,
  period,
  onClose,
}: {
  person: PersonRow | null;
  period: string;
  onClose: () => void;
}) {
  const bounds = periodBounds(period);
  const employeeId = person?.employeeId ?? "";
  const [viewing, setViewing] = useState<DailyWorkReport | null>(null);

  const grid = useQuery({
    queryKey: ["kra-grid", period],
    queryFn: () => kraService.scoreGrid(period),
    enabled: Boolean(person),
  });
  const trend = useQuery({
    queryKey: ["kra-trend", employeeId, period],
    queryFn: () => kraService.trend(employeeId, period, 6),
    enabled: Boolean(person),
  });
  const reports = useQuery({
    queryKey: ["org-reports", "person", employeeId, bounds.from, bounds.to],
    queryFn: () => workService.listReportsBetween(bounds.from, bounds.to, { employeeId }),
    enabled: Boolean(person),
  });

  const kpis = (grid.data ?? []).filter((row) => row.employeeId === employeeId);

  return (
    <Sheet open={person != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {person ? (
          <>
            <SheetHeader>
              <SheetTitle>{person.name}</SheetTitle>
              <SheetDescription>
                {[person.code, person.department].filter(Boolean).join(" · ")} · {period}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniStat label="Performance index" value={scoreText(person.performanceIndex)}>
                <BandLabel band={performanceBand(person.performanceIndex)} />
              </MiniStat>
              <MiniStat label="Attendance" value={pct(person.attendancePercent)} />
              <MiniStat
                label="Reports filed"
                value={pct(person.work ? filingRate(person.work) : null)}
              >
                {person.work ? (
                  <span className="text-xs text-muted-foreground">
                    {person.work.late} late · {person.work.missed} missed
                  </span>
                ) : null}
              </MiniStat>
              <MiniStat label="Tasks done" value={pct(person.taskCompletion)} />
            </div>

            <section className="mt-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <LineChart className="size-4" /> Performance trend
              </h3>
              {trend.isLoading ? (
                <TableSkeleton rows={1} columns={6} />
              ) : (trend.data ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No scored months yet.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(trend.data ?? []).map((point) => (
                    <div key={point.period} className="rounded-lg border px-3 py-2 text-center">
                      <p className="text-[11px] text-muted-foreground">{point.period}</p>
                      <p className="text-sm font-semibold tabular-nums">
                        {scoreText(point.performanceIndex)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-semibold">KPI scores</h3>
              {grid.isLoading ? (
                <TableSkeleton rows={3} columns={4} />
              ) : grid.isError ? (
                <p className="mt-2 text-sm text-destructive">{errorText(grid.error)}</p>
              ) : kpis.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No KPIs are assigned for this month.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">KRA / KPI</th>
                        <th className="px-3 py-2 text-right font-semibold">Target</th>
                        <th className="px-3 py-2 text-right font-semibold">Actual</th>
                        <th className="px-3 py-2 text-right font-semibold">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {kpis.map((kpi) => (
                        <tr key={`${kpi.kraTemplateId}-${kpi.kpiDefinitionId}`}>
                          <td className="px-3 py-2">
                            <p className="font-medium">{kpi.metric}</p>
                            <p className="text-xs text-muted-foreground">
                              {kpi.kraName} · {kpi.weightage}%
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {kpi.target ?? "—"} {kpi.unit}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{kpi.actual ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {scoreText(kpi.score)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Work reports this month</h3>
              {reports.isLoading ? (
                <TableSkeleton rows={4} columns={3} />
              ) : reports.isError ? (
                <p className="mt-2 text-sm text-destructive">{errorText(reports.error)}</p>
              ) : (reports.data ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No reports this month.</p>
              ) : (
                <ul className="mt-2 divide-y rounded-lg border">
                  {(reports.data ?? []).map((report) => (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => setViewing(report)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="w-24 shrink-0 text-sm">
                          {shortDate(report.reportDate)}
                        </span>
                        <StatusBadge status={report.status} />
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {report.totalHours}h · {report.items.length}{" "}
                          {report.items.length === 1 ? "item" : "items"}
                        </span>
                        <span className="ml-auto">
                          <StatusBadge status={report.reviewStatus} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="mt-6">
              <Button asChild variant="outline" className="w-full">
                <Link to="/employees/$employeeId" params={{ employeeId: person.employeeId }}>
                  Open full profile
                </Link>
              </Button>
            </div>
          </>
        ) : null}
        <WorkReportDetailDialog report={viewing} readOnly onClose={() => setViewing(null)} />
      </SheetContent>
    </Sheet>
  );
}

function MiniStat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
