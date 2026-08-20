import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeIndianRupee,
  Briefcase,
  CalendarCheck,
  ClipboardList,
  LaptopMinimal,
  LifeBuoy,
  Target,
  TrendingDown,
  Users,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CardsSkeleton } from "@/components/common/States";
import { AttendanceAreaChart } from "@/components/charts/AttendanceAreaChart";
import { DistributionDonut } from "@/components/charts/DistributionDonut";
import { HeadcountBarChart } from "@/components/charts/HeadcountBarChart";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { insightsService } from "@/services/insightsService";
import { leaveService } from "@/services/leaveService";
import { talentService } from "@/services/talentService";
import { workplaceService } from "@/services/workplaceService";
import { attendanceService } from "@/services/attendanceService";
import { assetService } from "@/services/assetService";
import { useSession } from "@/hooks/useSession";
import { requireAuthForPath } from "@/lib/auth-guard";
import { compactInr, dayMonth, inr, initialsOf, percent, shortDate } from "@/lib/format";

export const Route = createFileRoute("/")({
  beforeLoad: () => requireAuthForPath("/"),
  head: () => ({
    meta: [
      { title: "Dashboard · Kinetix HRMS" },
      {
        name: "description",
        content:
          "Live workforce dashboard: attendance today, pending approvals, payroll status, hiring pipeline and asset health.",
      },
      { property: "og:title", content: "Kinetix Dashboard" },
      {
        property: "og:description",
        content: "Workforce insights, approvals and self-service in one HR command center.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { role } = useSession();
  return (
    <AppLayout>
      {role === "employee" ? <EmployeeDashboard /> : <OrgDashboard />}
    </AppLayout>
  );
}

function OrgDashboard() {
  const { user, role } = useSession();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => insightsService.companySummary() });
  const trend = useQuery({ queryKey: ["attendance-trend"], queryFn: () => insightsService.attendanceTrend() });
  const headcount = useQuery({ queryKey: ["headcount-trend"], queryFn: () => insightsService.headcountTrend() });
  const distribution = useQuery({ queryKey: ["dept-distribution"], queryFn: () => insightsService.departmentDistribution() });
  const pending = useQuery({ queryKey: ["leave", "all"], queryFn: () => leaveService.list({ status: "pending" }) });
  const openings = useQuery({ queryKey: ["openings", "open"], queryFn: () => talentService.openings({ status: "open" }) });
  const announcements = useQuery({ queryKey: ["announcements"], queryFn: () => workplaceService.announcements() });

  const s = summary.data;

  return (
    <>
      <PageHeader
        eyebrow={`Welcome back, ${user.name.split(" ")[0]}`}
        title="People operations overview"
        description="A single view of attendance, approvals, payroll and hiring across the organisation."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/reports">View reports</Link>
            </Button>
            <Button asChild>
              <Link to="/leave">Review approvals</Link>
            </Button>
          </>
        }
      />

      {summary.isLoading || !s ? (
        <CardsSkeleton count={4} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Headcount"
            value={String(s.headcount)}
            icon={Users}
            tone="primary"
            delta={{ value: "+2.1%", direction: "up" }}
            hint="vs last month"
          />
          <StatCard
            label="Present today"
            value={String(s.presentToday)}
            icon={CalendarCheck}
            tone="success"
            hint={`${s.wfhToday} WFH · ${s.lateToday} late`}
          />
          <StatCard
            label="Pending approvals"
            value={String(s.pendingApprovals)}
            icon={ClipboardList}
            tone="warning"
            hint={`${s.onLeaveToday} on leave today`}
          />
          <StatCard
            label="Payroll (current)"
            value={compactInr(s.payrollNet)}
            icon={BadgeIndianRupee}
            tone="info"
            hint={`Status: ${s.payrollStatus}`}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard
          title="Attendance trend"
          description="Present vs work-from-home across the week"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/attendance">Open attendance</Link>
            </Button>
          }
        >
          {trend.data ? <AttendanceAreaChart data={trend.data} /> : <div className="h-[260px]" />}
        </SectionCard>

        <SectionCard title="Department mix" description="Headcount distribution">
          {distribution.data ? (
            <DistributionDonut
              data={distribution.data.map((d) => ({ name: d.name, value: d.value }))}
            />
          ) : (
            <div className="h-[260px]" />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Joiners vs exits" description="Rolling six months">
          {headcount.data ? <HeadcountBarChart data={headcount.data} /> : <div className="h-[260px]" />}
        </SectionCard>

        <SectionCard
          title="Approvals waiting on you"
          description="Leave requests in the queue"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/leave">All requests</Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {(pending.data ?? []).slice(0, 5).map((request) => (
              <li key={request.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-xs font-bold">
                  {initialsOf(request.employeeName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{request.employeeName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {request.type} · {dayMonth(request.from)} – {dayMonth(request.to)} ·{" "}
                    {request.days}d
                  </p>
                </div>
                <StatusBadge status={request.status} />
              </li>
            ))}
            {pending.data && pending.data.length === 0 ? (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No pending approvals.
              </li>
            ) : null}
          </ul>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Hiring pipeline"
          description={`${openings.data?.length ?? 0} open requisitions`}
          bodyClassName="space-y-3 p-5"
        >
          {(openings.data ?? []).slice(0, 4).map((job) => (
            <div key={job.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{job.title}</p>
                <StatusBadge status={job.stage} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {job.department} · {job.location} · {job.applicants} applicants
              </p>
            </div>
          ))}
          {role !== "manager" ? (
            <Button asChild variant="outline" className="w-full">
              <Link to="/recruitment">Open recruitment</Link>
            </Button>
          ) : null}
        </SectionCard>

        <SectionCard title="Workplace health" description="Assets and helpdesk load" bodyClassName="space-y-4 p-5">
          <HealthRow
            icon={LaptopMinimal}
            label="Assets assigned"
            value={String(s?.assetsAssigned ?? 0)}
            note={`${s?.assetsInRepair ?? 0} in repair`}
          />
          <HealthRow
            icon={LifeBuoy}
            label="Open tickets"
            value={String(s?.openTickets ?? 0)}
            note="HR helpdesk"
          />
          <HealthRow
            icon={Briefcase}
            label="Open positions"
            value={String(s?.openPositions ?? 0)}
            note="across departments"
          />
          <HealthRow
            icon={TrendingDown}
            label="Attrition"
            value={`${s?.attritionRate ?? 0}%`}
            note={`avg tenure ${s?.avgTenureYears ?? 0} yrs`}
          />
        </SectionCard>

        <SectionCard
          title="Announcements"
          description="Latest company updates"
          bodyClassName="space-y-3 p-5"
        >
          {(announcements.data ?? []).slice(0, 3).map((item) => (
            <div key={item.id} className="rounded-xl border border-border p-3">
              <p className="truncate text-sm font-semibold">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                {item.author} · {shortDate(item.publishedOn)}
              </p>
            </div>
          ))}
          <Button asChild variant="outline" className="w-full">
            <Link to="/announcements">All announcements</Link>
          </Button>
        </SectionCard>
      </div>
    </>
  );
}

function HealthRow({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{note}</p>
      </div>
      <p className="font-display text-lg font-bold">{value}</p>
    </div>
  );
}

function EmployeeDashboard() {
  const { user } = useSession();
  const today = useQuery({
    queryKey: ["attendance-today", user.id],
    queryFn: () => attendanceService.today(user.id),
  });
  const balance = useQuery({
    queryKey: ["leave-balance", user.id],
    queryFn: () => leaveService.balance(user.id),
  });
  const myLeave = useQuery({
    queryKey: ["leave", user.id],
    queryFn: () => leaveService.list({ employeeId: user.id }),
  });
  const myGoals = useQuery({
    queryKey: ["goals", user.name],
    queryFn: () => talentService.goalsOf(user.name),
  });
  const myAssets = useQuery({
    queryKey: ["assets", user.name],
    queryFn: () => assetService.assignedTo(user.name),
  });
  const payslips = useQuery({
    queryKey: ["payslips", user.id],
    queryFn: () => import("@/services/payrollService").then((m) => m.payrollService.payslips({ employeeId: user.id })),
  });

  const b = balance.data;

  return (
    <>
      <PageHeader
        eyebrow="My workspace"
        title={`Hello, ${user.name.split(" ")[0]}`}
        description="Your attendance, leave balance, payslips and goals in one place."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/leave">Apply for leave</Link>
            </Button>
            <Button asChild>
              <Link to="/attendance">My attendance</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today"
          value={today.data?.status ? today.data.status.replace("-", " ") : "—"}
          icon={CalendarCheck}
          tone="success"
          hint={
            today.data
              ? `In ${today.data.checkIn ?? "—"} · Out ${today.data.checkOut ?? "—"}`
              : "No record yet"
          }
        />
        <StatCard
          label="Leave balance"
          value={String((b?.casual ?? 0) + (b?.sick ?? 0) + (b?.earned ?? 0))}
          icon={ClipboardList}
          tone="info"
          hint={`Casual ${b?.casual ?? 0} · Sick ${b?.sick ?? 0} · Earned ${b?.earned ?? 0}`}
        />
        <StatCard
          label="Last net pay"
          value={payslips.data?.[0] ? inr(payslips.data[0].net) : "—"}
          icon={BadgeIndianRupee}
          tone="primary"
          hint={payslips.data?.[0]?.period ?? "Awaiting payroll"}
        />
        <StatCard
          label="Assets held"
          value={String(myAssets.data?.length ?? 0)}
          icon={LaptopMinimal}
          tone="accent"
          hint="Issued by IT"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="My goals" description="Current performance cycle" bodyClassName="space-y-4 p-5">
          {(myGoals.data ?? []).map((goal) => (
            <div key={goal.id}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{goal.title}</p>
                <StatusBadge status={goal.status} />
              </div>
              <Progress value={goal.progress} className="mt-2 h-2" />
              <p className="mt-1 text-xs text-muted-foreground">
                {percent(goal.progress)} · due {shortDate(goal.dueDate)}
              </p>
            </div>
          ))}
          {myGoals.data && myGoals.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No goals assigned yet.</p>
          ) : null}
        </SectionCard>

        <SectionCard title="My leave requests" description="Recent activity" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(myLeave.data ?? []).map((request) => (
              <li key={request.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{request.type} leave</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {dayMonth(request.from)} – {dayMonth(request.to)} · {request.days}d
                  </p>
                </div>
                <StatusBadge status={request.status} />
              </li>
            ))}
            {myLeave.data && myLeave.data.length === 0 ? (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                You have not applied for leave yet.
              </li>
            ) : null}
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="Assets assigned to me" description="Report an issue from the assets page" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {(myAssets.data ?? []).map((asset) => (
            <li key={asset.id} className="flex items-center gap-3 px-5 py-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-primary">
                <LaptopMinimal className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{asset.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {asset.tag} · issued {shortDate(asset.assignedOn)}
                </p>
              </div>
              <StatusBadge status={asset.condition} />
            </li>
          ))}
          {myAssets.data && myAssets.data.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No assets currently assigned.
            </li>
          ) : null}
        </ul>
      </SectionCard>

      <SectionCard title="Goals at a glance" description="Progress weighting" bodyClassName="p-5">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Target className="size-4 text-primary" />
          Weighted completion{" "}
          <span className="font-semibold text-foreground">
            {percent(
              (myGoals.data ?? []).reduce((sum, g) => sum + (g.progress * g.weight) / 100, 0),
            )}
          </span>
        </div>
      </SectionCard>
    </>
  );
}
