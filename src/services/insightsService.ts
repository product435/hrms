import {
  assets as fixtureAssets,
  attendance as fixtureAttendance,
  attendanceTrend as fixtureAttendanceTrend,
  departments as fixtureDepartments,
  employees as fixtureEmployees,
  headcountTrend as fixtureHeadcount,
  leaveRequests as fixtureLeave,
  payrollRuns as fixturePayroll,
  tickets as fixtureTickets,
} from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { fromFixture, requireOrganizationId } from "./api";
import { displayName, normalizeKey } from "@/lib/normalize";

// "YYYY-MM" for the given date, used as the month bucket key throughout this
// file.
function monthLabel(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Adds `delta` calendar months to a "YYYY-MM" label (delta may be negative).
function addMonths(label: string, delta: number): string {
  const year = Number(label.slice(0, 4));
  const month = Number(label.slice(5, 7));
  return monthLabel(new Date(Date.UTC(year, month - 1 + delta, 1)));
}
export interface CompanySummary {
  headcount: number;
  presentToday: number;
  onLeaveToday: number;
  wfhToday: number;
  lateToday: number;
  // The schema has no exit-date column on employees -- employment_status
  // records THAT someone resigned, not WHEN, so a real (time-bounded)
  // attrition rate can't be computed. null means "not determinable from the
  // current schema", not zero attrition -- the UI must render this as N/A.
  attritionRate: number | null;
  openPositions: number;
  pendingApprovals: number;
  payrollNet: number;
  payrollStatus: string;
  assetsAssigned: number;
  assetsInRepair: number;
  openTickets: number;
  avgTenureYears: number | null;
}
export const insightsService = {
  async companySummary(): Promise<CompanySummary> {
    if (!isSupabaseConfigured || !supabase) {
      const current = fixturePayroll[0];
      return fromFixture({
        headcount: fixtureDepartments.reduce((s, d) => s + d.headcount, 0),
        presentToday: 142,
        onLeaveToday: 11,
        wfhToday: 26,
        lateToday: 7,
        attritionRate: 8.4,
        openPositions: fixtureDepartments.reduce((s, d) => s + d.openRoles, 0),
        pendingApprovals: fixtureLeave.filter((l) => l.status === "pending").length,
        payrollNet: current?.net ?? 0,
        payrollStatus: current?.status ?? "draft",
        assetsAssigned: fixtureAssets.filter((a) => a.status === "assigned").length,
        assetsInRepair: fixtureAssets.filter((a) => a.status === "in-repair").length,
        openTickets: fixtureTickets.filter((t) => !["closed", "resolved"].includes(t.status))
          .length,
        avgTenureYears: 2.9,
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const [
      { count: headcount },
      { data: att },
      { data: leaves },
      { data: jobs },
      { data: latestRun },
      { data: assets },
      { data: tickets },
      { data: activeJoiningDates },
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .neq("employment_status", "resigned"),
      supabase.from("attendance_records").select("status").eq("attendance_date", today),
      supabase.from("leave_requests").select("status,start_date,end_date"),
      supabase.from("job_openings").select("id").eq("status", "open"),
      supabase
        .from("payroll_runs")
        .select("id,status,year,month")
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("assets").select("status"),
      supabase.from("helpdesk_tickets").select("status"),
      supabase.from("employees").select("joining_date").neq("employment_status", "resigned"),
    ]);
    const tenureYears = (activeJoiningDates ?? [])
      .map((r) => r.joining_date)
      .filter((d): d is string => Boolean(d))
      .map((d) => (Date.now() - new Date(d).getTime()) / (365.25 * 86400000));
    const avgTenureYears = tenureYears.length
      ? Number((tenureYears.reduce((sum, y) => sum + y, 0) / tenureYears.length).toFixed(1))
      : null;
    const payrollNet = latestRun
      ? await supabase
          .from("payroll_records")
          .select("net_salary")
          .eq("payroll_run_id", latestRun.id)
          .then(({ data }) => (data ?? []).reduce((sum, r) => sum + Number(r.net_salary ?? 0), 0))
      : 0;
    return {
      headcount: headcount ?? 0,
      presentToday: (att ?? []).filter((r) => r.status === "present").length,
      onLeaveToday: (leaves ?? []).filter(
        (r) => r.status === "approved" && (r.start_date ?? "") <= today && (r.end_date ?? "") >= today,
      ).length,
      wfhToday: (att ?? []).filter((r) => r.status === "wfh").length,
      lateToday: (att ?? []).filter((r) => r.status === "late").length,
      attritionRate: null,
      openPositions: (jobs ?? []).length,
      pendingApprovals: (leaves ?? []).filter((r) => r.status === "pending").length,
      payrollNet,
      payrollStatus: latestRun?.status ?? "draft",
      assetsAssigned: (assets ?? []).filter((r) => r.status === "assigned").length,
      assetsInRepair: (assets ?? []).filter((r) => r.status === "in-repair").length,
      openTickets: (tickets ?? []).filter((r) => !["closed", "resolved"].includes(r.status ?? ""))
        .length,
      avgTenureYears,
    };
  },
  async attendanceTrend() {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureAttendanceTrend);
    const { data, error } = await supabase
      .from("attendance_records")
      .select("attendance_date,status")
      .gte("attendance_date", new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10))
      .order("attendance_date");
    if (error) throw error;
    const grouped = new Map<string, any>();
    (data ?? []).forEach((r: any) => {
      const p = grouped.get(r.attendance_date) ?? {
        label: r.attendance_date,
        present: 0,
        absent: 0,
        wfh: 0,
      };
      if (r.status === "wfh") p.wfh++;
      else if (r.status === "absent") p.absent++;
      else p.present++;
      grouped.set(r.attendance_date, p);
    });
    return [...grouped.values()];
  },
  // `month` is an optional "YYYY-MM" label. When omitted, returns the
  // trailing six calendar months (ending at the current month). When given,
  // returns that single month's real joined/exited counts and its running
  // headcount as of that month.
  async headcountTrend(month?: string) {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureHeadcount);
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("employees")
      .select("joining_date,employment_status,updated_at")
      .eq("organization_id", organizationId);
    if (error) throw error;
    const byMonth = new Map<string, { joined: number; exited: number }>();
    const bump = (label: string, key: "joined" | "exited") => {
      const point = byMonth.get(label) ?? { joined: 0, exited: 0 };
      point[key] += 1;
      byMonth.set(label, point);
    };
    (data ?? []).forEach((r) => {
      // A joiner is bucketed by their real joining_date, independent of
      // whether they've since resigned -- they still genuinely joined that
      // month.
      if (r.joining_date) bump(r.joining_date.slice(0, 7), "joined");
      // employees has no dedicated exit/termination-date column -- updated_at
      // is the closest real, existing signal for when a resignation was
      // recorded (the set_updated_at trigger bumps it whenever
      // employment_status is changed to "resigned"). Previously this bucketed
      // exits into the employee's *joining* month instead, which is wrong
      // for anyone who resigned in a different month than they joined.
      if (r.employment_status === "resigned" && r.updated_at) bump(r.updated_at.slice(0, 7), "exited");
    });
    const currentLabel = monthLabel(new Date());
    const trailingWindowStart = addMonths(currentLabel, -5);
    const dataLabels = [...byMonth.keys()].sort((a, b) => a.localeCompare(b));
    // Walk a continuous calendar sequence (not just months that happen to
    // have data) so months with zero joiners/exits still render as a real
    // zero bar instead of silently disappearing from "Last 6 Months", and so
    // the running headcount never skips a month. The sequence always covers
    // at least the trailing 6-month display window, and starts earlier still
    // if real data goes back further, so the running total accumulates from
    // the true start of history.
    const earliestDataLabel = dataLabels[0];
    const earliestLabel = earliestDataLabel && earliestDataLabel < trailingWindowStart ? earliestDataLabel : trailingWindowStart;
    const allLabels: string[] = [];
    for (let label = earliestLabel; label <= currentLabel; label = addMonths(label, 1)) {
      allLabels.push(label);
    }
    let running = 0;
    const allPoints = allLabels.map((label) => {
      const point = byMonth.get(label) ?? { joined: 0, exited: 0 };
      running += point.joined - point.exited;
      return { label, joined: point.joined, exited: point.exited, headcount: running };
    });
    if (month) {
      const found = allPoints.find((p) => p.label === month);
      // A selected month before any employee existed genuinely had zero
      // headcount and zero movement -- not missing data.
      return found ? [found] : [{ label: month, joined: 0, exited: 0, headcount: 0 }];
    }
    // Matches the "Last 6 Months" default on the Dashboard card.
    return allPoints.slice(-6);
  },
  async departmentDistribution(managerId?: string) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureDepartments.map((d) => ({
          name: d.name,
          value: d.headcount,
          openRoles: d.openRoles,
        })),
      );
    // authenticated user -> organization context -> departments.organization_id
    // -> departments.id/name -> employees.department_id. RLS already scopes
    // both tables to the caller's own organization, but the filter is made
    // explicit here too so the query itself (not just the policy) reflects
    // that data flow.
    const organizationId = await requireOrganizationId();
    const [{ data: departments, error: departmentError }, { data: employees, error: employeeError }] = await Promise.all([
      supabase.from("departments").select("id,name").eq("organization_id", organizationId),
      managerId
        ? supabase.from("employees").select("department_id").eq("organization_id", organizationId).eq("manager_id", managerId)
        : supabase.from("employees").select("department_id").eq("organization_id", organizationId),
    ]);
    if (departmentError) throw departmentError;
    if (employeeError) throw employeeError;
    const counts = new Map<string, number>();
    let unassigned = 0;
    (employees ?? []).forEach((employee) => {
      if (employee.department_id) counts.set(employee.department_id, (counts.get(employee.department_id) ?? 0) + 1);
      else unassigned += 1;
    });
    // Same normalized-name aggregation as employeeService.departments(), so
    // duplicate department rows (e.g. "QA", "QA ") show as one chart segment
    // with a combined headcount here too, on both Dashboard and Reports.
    const grouped = new Map<string, { name: string; value: number }>();
    (departments ?? []).forEach((d) => {
      const key = d.name ? normalizeKey(d.name) : "unassigned";
      const value = counts.get(d.id) ?? 0;
      const existing = grouped.get(key);
      if (existing) existing.value += value;
      else grouped.set(key, { name: d.name ? displayName(d.name) : "Unassigned", value });
    });
    // Employees with no department_id at all (never grouped into a real
    // department -- shown as their own explicit segment, not hidden).
    if (unassigned > 0) {
      const existing = grouped.get("unassigned");
      if (existing) existing.value += unassigned;
      else grouped.set("unassigned", { name: "Unassigned", value: unassigned });
    }
    return [...grouped.values()].map((g) => ({ ...g, openRoles: 0 }));
  },
  async leaveMix() {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        ["Casual", "Sick", "Earned", "Unpaid", "Comp-off"].map((type) => ({
          name: type,
          value: fixtureLeave.filter((l) => l.type === type).reduce((s, l) => s + l.days, 0),
        })),
      );
    const { data, error } = await supabase.from("leave_requests").select("total_days, leave_types(name)");
    if (error) throw error;
    const map = new Map<string, number>();
    (data ?? []).forEach((r) => {
      const name = r.leave_types?.name ?? "Other";
      map.set(name, (map.get(name) ?? 0) + Number(r.total_days ?? 0));
    });
    return [...map].map(([name, value]) => ({ name, value }));
  },
  async todaySnapshot() {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureAttendance);
    const { data, error } = await supabase
      .from("attendance_records")
      .select("*, employees(first_name,last_name), shifts(name)");
    if (error) throw error;
    return data ?? [];
  },
  async directory() {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureEmployees);
    const { data, error } = await supabase.from("employees").select("*");
    if (error) throw error;
    return data ?? [];
  },
};
