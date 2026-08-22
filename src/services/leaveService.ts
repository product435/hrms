import { employees as fixtureEmployees, leaveRequests as fixtureLeave } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { LeaveRequest } from "@/types";
import { currentUserId, fromFixture, matchesSearch, requireEmployeeId, type QueryOptions } from "./api";

function mapLeave(row: any): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employees ? `${row.employees.first_name} ${row.employees.last_name}` : "",
    type: row.leave_types?.name ?? "",
    from: row.start_date,
    to: row.end_date,
    days: Number(row.total_days ?? 0),
    reason: row.reason,
    status: row.status,
    appliedOn: row.start_date,
    approver: row.approved_by_profile?.full_name ?? "",
  };
}
export const leaveService = {
  async list(options: QueryOptions = {}): Promise<LeaveRequest[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureLeave.filter(
          (r) =>
            matchesSearch([r.employeeName, r.type, r.reason], options.search) &&
            (!options.status || options.status === "all" || r.status === options.status) &&
            (!options.employeeId || r.employeeId === options.employeeId),
        ),
      );
    let query = supabase
      .from("leave_requests")
      .select(
        "*, employees(first_name,last_name), leave_types(name), approved_by_profile:approved_by(full_name)",
      );
    if (options.employeeId) query = query.eq("employee_id", options.employeeId);
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapLeave)
      .filter((r) => matchesSearch([r.employeeName, r.type, r.reason], options.search));
  },
  // Managers only ever see their direct reports' rows here (RLS:
  // leave_requests_manager_view_team scopes SELECT to is_my_direct_report),
  // so there's no need to filter by an approver column -- which is just as
  // well, since current_approver is never populated by apply().
  async pendingApprovals(): Promise<LeaveRequest[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureLeave.filter((r) => r.status === "pending"));
    const { data, error } = await supabase
      .from("leave_requests")
      .select(
        "*, employees(first_name,last_name), leave_types(name), approved_by_profile:approved_by(full_name)",
      )
      .eq("status", "pending");
    if (error) throw error;
    return (data ?? []).map(mapLeave);
  },
  // leave_types is admin-configurable, so the balance breakdown is built
  // from whatever types actually exist in the organisation rather than a
  // fixed casual/sick/earned/unpaid list -- a type that doesn't exist yet
  // never shows a fake zero balance, and a newly added type shows up
  // automatically. Balance = annual_limit minus days already approved or
  // pending this calendar year.
  async types(): Promise<{ id: string; name: string; annualLimit: number }[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        [...new Set(fixtureLeave.map((l) => l.type))].map((name) => ({ id: name, name, annualLimit: 0 })),
      );
    const { data, error } = await supabase.from("leave_types").select("id,name,annual_limit").order("name");
    if (error) throw error;
    return (data ?? []).map((t) => ({ id: t.id, name: t.name ?? "", annualLimit: Number(t.annual_limit ?? 0) }));
  },
  async balance(employeeId: string): Promise<{ id: string; name: string; allocated: number; used: number; remaining: number }[]> {
    if (!isSupabaseConfigured || !supabase) {
      const employee = fixtureEmployees.find((e) => e.id === employeeId);
      const bal = employee?.leaveBalance ?? { casual: 0, sick: 0, earned: 0, unpaid: 0 };
      return fromFixture(
        Object.entries(bal).map(([name, remaining]) => ({ id: name, name, allocated: remaining, used: 0, remaining })),
      );
    }
    const resolved = await requireEmployeeId(employeeId);
    const year = new Date().getFullYear();
    const [{ data: types, error: typesError }, { data: requests, error: requestsError }] = await Promise.all([
      supabase.from("leave_types").select("id,name,annual_limit").order("name"),
      supabase
        .from("leave_requests")
        .select("leave_type_id,total_days")
        .eq("employee_id", resolved)
        .in("status", ["approved", "pending"])
        .gte("start_date", `${year}-01-01`)
        .lte("start_date", `${year}-12-31`),
    ]);
    if (typesError) throw typesError;
    if (requestsError) throw requestsError;
    const usedByType = new Map<string, number>();
    (requests ?? []).forEach((r) => {
      if (!r.leave_type_id) return;
      usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) ?? 0) + Number(r.total_days ?? 0));
    });
    return (types ?? []).map((t) => {
      const allocated = Number(t.annual_limit ?? 0);
      const used = usedByType.get(t.id) ?? 0;
      return { id: t.id, name: t.name ?? "", allocated, used, remaining: Math.max(allocated - used, 0) };
    });
  },
  async apply(payload: { type: string; from: string; to: string; reason: string }) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ ...payload, status: "pending" as const });
    const employeeId = await requireEmployeeId();
    const { data: leaveType, error: leaveTypeError } = await supabase
      .from("leave_types")
      .select("id")
      .ilike("name", `%${payload.type}%`)
      .maybeSingle();
    if (leaveTypeError) throw leaveTypeError;
    const totalDays =
      Math.round(
        (new Date(payload.to).getTime() - new Date(payload.from).getTime()) / 86400000,
      ) + 1;
    const { data, error } = await supabase
      .from("leave_requests")
      .insert({
        employee_id: employeeId,
        leave_type_id: leaveType?.id ?? null,
        start_date: payload.from,
        end_date: payload.to,
        total_days: totalDays,
        reason: payload.reason,
        status: "pending",
      })
      .select("*, employees(first_name,last_name), leave_types(name)")
      .single();
    if (error) throw error;
    return mapLeave(data);
  },
  async decide(id: string, decision: "approved" | "rejected") {
    if (!isSupabaseConfigured || !supabase) return fromFixture({ id, status: decision });
    const approvedBy = await currentUserId();
    const { data, error } = await supabase
      .from("leave_requests")
      .update({ status: decision, ...(approvedBy ? { approved_by: approvedBy } : {}) })
      .eq("id", id)
      .select("*, employees(first_name,last_name), leave_types(name), approved_by_profile:approved_by(full_name)")
      .single();
    if (error) throw error;
    return mapLeave(data);
  },
};
