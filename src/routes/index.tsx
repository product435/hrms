import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";
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
import { passwordResetRequestService } from "@/services/passwordResetRequestService";
import { useSession } from "@/hooks/useSession";
import { requireAuthForPath } from "@/lib/auth-guard";
import { compactInr, dayMonth, indianTime, inr, initialsOf, percent, shortDate } from "@/lib/format";

export const Route = createFileRoute("/")({
  beforeLoad: () => requireAuthForPath("/"),
  head: () => ({
    meta: [
      { title: "Dashboard · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Live workforce dashboard: attendance today, pending approvals, payroll status, hiring pipeline and asset health.",
      },
      { property: "og:title", content: "JeeVijay HRMS Dashboard" },
      {
        property: "og:description",
        content: "Workforce insights, approvals and self-service in one HR command center.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { role, isLoading } = useSession();
  return (
    <AppLayout>
      {isLoading ? (
        <CardsSkeleton count={4} />
      ) : role === "employee" ? (
        <EmployeeDashboard />
      ) : (
        <OrgDashboard />
      )}
    </AppLayout>
  );
}

// Trailing 12 real calendar months (most recent first), generated from
// today's date -- never a hardcoded list -- for the "Joiners vs exits" month
// selector.
function recentMonthOptions(count = 12): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function monthOptionLabel(label: string): string {
  const year = Number(label.slice(0, 4));
  const month = Number(label.slice(5, 7));
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function OrgDashboard() {
  const { user, role } = useSession();
  const [headcountMonth, setHeadcountMonth] = useState("");
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => insightsService.companySummary() });
  const trend = useQuery({ queryKey: ["attendance-trend"], queryFn: () => insightsService.attendanceTrend() });
  const headcount = useQuery({
    queryKey: ["headcount-trend", headcountMonth],
    queryFn: () => insightsService.headcountTrend(headcountMonth || undefined),
  });
  const distribution = useQuery({ queryKey: ["dept-distribution", role, user.employeeId], queryFn: () => insightsService.departmentDistribution(role === "manager" ? user.employeeId : undefined) });
  // RLS returns a manager's own pending request alongside their team's
  // (leave_requests_self_select OR leave_requests_manager_view_team), but a
  // manager can never decide on their own request -- only a direct
  // report's -- so it's excluded from "waiting on you" specifically.
  const pending = useQuery({
    queryKey: ["leave", "pending", role, user.id],
    queryFn: async () => {
      const rows = role === "manager" ? await leaveService.pendingApprovals() : await leaveService.list({ status: "pending" });
      return role === "manager" ? rows.filter((r) => r.employeeId !== (user.employeeId ?? user.id)) : rows;
    },
  });
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
              <Link to="/leave" search={{ status: "pending" }}>
                Review approvals
              </Link>
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
        <SectionCard
          title="Joiners vs exits"
          description={headcountMonth ? monthOptionLabel(headcountMonth) : "Last 6 Months"}
          action={
            <select
              aria-label="Joiners vs exits range"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={headcountMonth}
              onChange={(e) => setHeadcountMonth(e.target.value)}
            >
              <option value="">Last 6 Months</option>
              {recentMonthOptions().map((m) => (
                <option key={m} value={m}>
                  {monthOptionLabel(m)}
                </option>
              ))}
            </select>
          }
        >
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
            value={s?.attritionRate != null ? `${s.attritionRate}%` : "N/A"}
            note={s?.avgTenureYears != null ? `avg tenure ${s.avgTenureYears} yrs` : "avg tenure N/A"}
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

      {role === "admin" ? <PasswordResetRequestsSection /> : null}
    </>
  );
}

// Admin-only: users don't choose their own role or reset their own password
// unilaterally -- Forgot Password queues a request here for every role
// except the Admin's own (who has no one else to approve it). Approving
// sends the real Supabase recovery email; nothing here ever generates or
// displays a plaintext password.
function PasswordResetRequestsSection() {
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ["password-reset-requests"],
    queryFn: () => passwordResetRequestService.listPending(),
  });

  const approve = useMutation({
    mutationFn: (vars: { id: string; email: string }) => passwordResetRequestService.approve(vars.id, vars.email),
    onSuccess: () => {
      toast.success("Reset approved", { description: "A secure reset email has been sent." });
      void queryClient.invalidateQueries({ queryKey: ["password-reset-requests"] });
    },
    onError: (e) =>
      toast.error("Could not approve request", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => passwordResetRequestService.reject(id, "Rejected by admin"),
    onSuccess: () => {
      toast.success("Request rejected");
      void queryClient.invalidateQueries({ queryKey: ["password-reset-requests"] });
    },
    onError: (e) =>
      toast.error("Could not reject request", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const items = requests.data ?? [];
  if (!requests.isLoading && items.length === 0) return null;

  return (
    <SectionCard
      title="Password reset requests"
      description="Approve to send a secure reset link, or reject."
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{item.employeeName || item.email}</p>
              <p className="truncate text-xs text-muted-foreground">
                {item.email} · requested {shortDate(item.requestedAt)}
              </p>
            </div>
            <StatusBadge status={item.status} />
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={approve.isPending || reject.isPending}
                onClick={() => approve.mutate({ id: item.id, email: item.email })}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={approve.isPending || reject.isPending}
                onClick={() => reject.mutate(item.id)}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
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
    queryFn: () => attendanceService.today(user.employeeId ?? user.id),
  });
  const myLeave = useQuery({
    queryKey: ["leave", user.id],
    queryFn: () => leaveService.list({ employeeId: user.employeeId ?? user.id }),
  });
  const myGoals = useQuery({
    queryKey: ["goals", user.employeeId ?? user.id],
    queryFn: () => talentService.goalsOf(user.employeeId ?? user.id),
  });
  const myAssets = useQuery({
    queryKey: ["assets", user.employeeId ?? user.id],
    queryFn: () => assetService.assignedTo(user.employeeId ?? user.id),
  });
  const myBalance = useQuery({
    queryKey: ["leave-balance", user.employeeId ?? user.id],
    queryFn: () => leaveService.balance(user.employeeId ?? user.id),
  });
  const payslips = useQuery({
    queryKey: ["payslips", user.id],
    queryFn: () => import("@/services/payrollService").then((m) => m.payrollService.payslips({ employeeId: user.employeeId ?? user.id })),
  });

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
              ? `In ${indianTime(today.data.checkIn)} · Out ${indianTime(today.data.checkOut)}`
              : "No record yet"
          }
        />
        <StatCard
          label="Leave balance"
          value={myBalance.data ? String(myBalance.data.reduce((sum, entry) => sum + entry.remaining, 0)) : "—"}
          icon={ClipboardList}
          tone="info"
          hint={myBalance.data?.length ? myBalance.data.map((entry) => `${entry.name.replace(/ Leave$/i, "")} ${entry.remaining}`).join(" · ") : "No leave types configured"}
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
