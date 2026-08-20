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
import { fromFixture } from "./api";
export interface CompanySummary {
  headcount: number;
  presentToday: number;
  onLeaveToday: number;
  wfhToday: number;
  lateToday: number;
  attritionRate: number;
  openPositions: number;
  pendingApprovals: number;
  payrollNet: number;
  payrollStatus: string;
  assetsAssigned: number;
  assetsInRepair: number;
  openTickets: number;
  avgTenureYears: number;
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
      { data: runs },
      { data: assets },
      { data: tickets },
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .neq("status", "resigned"),
      supabase.from("attendance").select("status").eq("attendance_date", today),
      supabase.from("leave").select("status,from_date,to_date"),
      supabase.from("jobs").select("id").eq("stage", "open"),
      supabase
        .from("payroll_runs")
        .select("net,status")
        .order("period", { ascending: false })
        .limit(1),
      supabase.from("assets").select("status"),
      supabase.from("helpdesk_requests").select("status"),
    ]);
    return {
      headcount: headcount ?? 0,
      presentToday: (att ?? []).filter((r: any) => r.status === "present").length,
      onLeaveToday: (leaves ?? []).filter(
        (r: any) => r.status === "approved" && r.from_date <= today && r.to_date >= today,
      ).length,
      wfhToday: (att ?? []).filter((r: any) => r.status === "wfh").length,
      lateToday: (att ?? []).filter((r: any) => r.status === "late").length,
      attritionRate: 0,
      openPositions: (jobs ?? []).length,
      pendingApprovals: (leaves ?? []).filter((r: any) => r.status === "pending").length,
      payrollNet: Number(runs?.[0]?.net ?? 0),
      payrollStatus: runs?.[0]?.status ?? "draft",
      assetsAssigned: (assets ?? []).filter((r: any) => r.status === "assigned").length,
      assetsInRepair: (assets ?? []).filter((r: any) => r.status === "in-repair").length,
      openTickets: (tickets ?? []).filter((r: any) => !["closed", "resolved"].includes(r.status))
        .length,
      avgTenureYears: 0,
    };
  },
  async attendanceTrend() {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureAttendanceTrend);
    const { data, error } = await supabase
      .from("attendance")
      .select("attendance_date,status")
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
  async headcountTrend() {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureHeadcount);
    const { data, error } = await supabase.from("employees").select("joined_on,status");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      label: r.joined_on,
      joined: 1,
      exited: r.status === "resigned" ? 1 : 0,
      headcount: 1,
    }));
  },
  async departmentDistribution() {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureDepartments.map((d) => ({
          name: d.name,
          value: d.headcount,
          openRoles: d.openRoles,
        })),
      );
    const { data, error } = await supabase.from("departments").select("id,name,employees(id)");
    if (error) throw error;
    return (data ?? []).map((d: any) => ({
      name: d.name,
      value: (d.employees ?? []).length,
      openRoles: 0,
    }));
  },
  async leaveMix() {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        ["Casual", "Sick", "Earned", "Unpaid", "Comp-off"].map((type) => ({
          name: type,
          value: fixtureLeave.filter((l) => l.type === type).reduce((s, l) => s + l.days, 0),
        })),
      );
    const { data, error } = await supabase.from("leave").select("leave_type,days");
    if (error) throw error;
    const map = new Map<string, number>();
    (data ?? []).forEach((r: any) =>
      map.set(r.leave_type, (map.get(r.leave_type) ?? 0) + Number(r.days)),
    );
    return [...map].map(([name, value]) => ({ name, value }));
  },
  async todaySnapshot() {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureAttendance);
    const { data, error } = await supabase
      .from("attendance")
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
