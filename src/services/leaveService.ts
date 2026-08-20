import { employees as fixtureEmployees, leaveRequests as fixtureLeave } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { LeaveRequest } from "@/types";
import { fromFixture, matchesSearch, requireEmployeeId, type QueryOptions } from "./api";

function mapLeave(row: any): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employees ? `${row.employees.first_name} ${row.employees.last_name}` : "",
    type: row.leave_type,
    from: row.from_date,
    to: row.to_date,
    days: Number(row.days),
    reason: row.reason,
    status: row.status,
    appliedOn: row.applied_on,
    approver: row.approver?.full_name ?? "",
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
      .select("*");
    if (options.employeeId) query = query.eq("employee_id", options.employeeId);
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapLeave)
      .filter((r) => matchesSearch([r.employeeName, r.type, r.reason], options.search));
  },
  async pendingApprovals(approver: string): Promise<LeaveRequest[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureLeave.filter((r) => r.status === "pending" && r.approver === approver),
      );
    const { data, error } = await supabase
      .from("leave_requests")
      .select("*")
      .eq("status", "pending");
    if (error) throw error;
    return (data ?? []).map(mapLeave);
  },
  async balance(employeeId: string) {
    if (!isSupabaseConfigured || !supabase) {
      const employee = fixtureEmployees.find((e) => e.id === employeeId);
      return fromFixture(employee?.leaveBalance ?? { casual: 0, sick: 0, earned: 0, unpaid: 0 });
    }
    return { casual: 0, sick: 0, earned: 0, unpaid: 0 };
  },
  async apply(payload: { type: string; from: string; to: string; reason: string }) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ ...payload, status: "pending" as const });
    const employeeId = await requireEmployeeId();
    const { data, error } = await supabase
      .from("leave_requests")
      .insert({
        employee_id: employeeId,
        reason: payload.reason,
      })
      .select()
      .single();
    if (error) throw error;
    return mapLeave(data);
  },
  async decide(id: string, decision: "approved" | "rejected") {
    if (!isSupabaseConfigured || !supabase) return fromFixture({ id, status: decision });
    const { data, error } = await supabase
      .from("leave_requests")
      .update({ status: decision })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return mapLeave(data);
  },
};
