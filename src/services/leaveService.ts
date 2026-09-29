/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joins are not in the generated row types. */
import { employees as fixtureEmployees, leaveRequests as fixtureLeave } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { LeaveRequest } from "@/types";
import { fromFixture, logAudit, matchesSearch, requireEmployeeId, type QueryOptions } from "./api";

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
  // Leads only see rows can_view_employee allows (department for a department
  // head, direct reports for a team lead). No approver-column filter: apply()
  // never sets current_approver.
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
        [...new Set(fixtureLeave.map((l) => l.type))].map((name) => ({
          id: name,
          name,
          annualLimit: 0,
        })),
      );
    const { data, error } = await supabase
      .from("leave_types")
      .select("id,name,annual_limit")
      .order("name");
    if (error) throw error;
    return (data ?? []).map((t) => ({
      id: t.id,
      name: t.name ?? "",
      annualLimit: Number(t.annual_limit ?? 0),
    }));
  },
  // Balance is now ledger-backed: change_days is negative on request (debit)
  // and positive on rejection or cancellation (credit-back), written by the
  // leave_ledger_trigger on leave_requests -- never client-written -- so this
  // always reflects a real, persisted transaction history rather than a live
  // recomputation.
  async balance(
    employeeId: string,
  ): Promise<{ id: string; name: string; allocated: number; used: number; remaining: number }[]> {
    if (!isSupabaseConfigured || !supabase) {
      const employee = fixtureEmployees.find((e) => e.id === employeeId);
      const bal = employee?.leaveBalance ?? { casual: 0, sick: 0, earned: 0, unpaid: 0 };
      return fromFixture(
        Object.entries(bal).map(([name, remaining]) => ({
          id: name,
          name,
          allocated: remaining,
          used: 0,
          remaining,
        })),
      );
    }
    const resolved = await requireEmployeeId(employeeId);
    const year = new Date().getFullYear();
    const [{ data: types, error: typesError }, { data: ledger, error: ledgerError }] =
      await Promise.all([
        supabase.from("leave_types").select("id,name,annual_limit").order("name"),
        supabase
          .from("leave_ledger")
          .select("leave_type_id,change_days")
          .eq("employee_id", resolved)
          .gte("created_at", `${year}-01-01`)
          .lte("created_at", `${year}-12-31`),
      ]);
    if (typesError) throw typesError;
    if (ledgerError) throw ledgerError;
    const usedByType = new Map<string, number>();
    (ledger ?? []).forEach((r) => {
      if (!r.leave_type_id) return;
      // change_days is negative for a debit, positive for a credit-back --
      // subtracting it accumulates the correct net "used" total.
      usedByType.set(
        r.leave_type_id,
        (usedByType.get(r.leave_type_id) ?? 0) - Number(r.change_days ?? 0),
      );
    });
    return (types ?? []).map((t) => {
      const allocated = Number(t.annual_limit ?? 0);
      const used = usedByType.get(t.id) ?? 0;
      return {
        id: t.id,
        name: t.name ?? "",
        allocated,
        used,
        remaining: Math.max(allocated - used, 0),
      };
    });
  },
  // Raw transaction history for the leave ledger/history view.
  async ledger(employeeId: string): Promise<
    {
      id: string;
      typeName: string;
      changeDays: number;
      transactionType: string;
      reason: string;
      createdAt: string;
    }[]
  > {
    if (!isSupabaseConfigured || !supabase) return fromFixture([]);
    const resolved = await requireEmployeeId(employeeId);
    const { data, error } = await supabase
      .from("leave_ledger")
      .select("id,change_days,transaction_type,reason,created_at,leave_types(name)")
      .eq("employee_id", resolved)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      typeName: r.leave_types?.name ?? "Leave",
      changeDays: Number(r.change_days ?? 0),
      transactionType: r.transaction_type ?? "",
      reason: r.reason ?? "",
      createdAt: r.created_at ?? "",
    }));
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
    if (leaveTypeError) throw new Error(leaveTypeError.message || "Could not submit the request.");
    const totalDays =
      Math.round((new Date(payload.to).getTime() - new Date(payload.from).getTime()) / 86400000) +
      1;
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
    if (error) throw new Error(error.message || "Could not submit the request.");
    void logAudit("leave_request_create", "leave_requests", data.id, null, {
      total_days: totalDays,
      status: "pending",
    });
    return mapLeave(data);
  },
  async decide(id: string, decision: "approved" | "rejected", rejectionReason?: string) {
    if (!isSupabaseConfigured || !supabase) return fromFixture({ id, status: decision });
    const client = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message?: string } | null }>;
    };
    const { error } = await client.rpc("decide_leave_request", {
      p_request_id: id,
      p_decision: decision,
      p_rejection_reason: rejectionReason?.trim() ? rejectionReason.trim() : null,
    });
    if (error) throw new Error(error.message || "Could not record the decision.");
    const { data, error: readError } = await supabase
      .from("leave_requests")
      .select(
        "*, employees(first_name,last_name), leave_types(name), approved_by_profile:approved_by(full_name)",
      )
      .eq("id", id)
      .single();
    if (readError) throw new Error(readError.message || "Could not record the decision.");
    void logAudit("leave_request_decide", "leave_requests", id, null, { status: decision });
    return mapLeave(data);
  },
  async cancel(id: string) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ id, status: "cancelled" as const });
    const client = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message?: string } | null }>;
    };
    const { error } = await client.rpc("cancel_leave_request", {
      p_request_id: id,
    });
    if (error) throw new Error(error.message || "Could not cancel the request.");
    const { data, error: readError } = await supabase
      .from("leave_requests")
      .select(
        "*, employees(first_name,last_name), leave_types(name), approved_by_profile:approved_by(full_name)",
      )
      .eq("id", id)
      .single();
    if (readError) throw new Error(readError.message || "Could not cancel the request.");
    void logAudit("leave_request_cancel", "leave_requests", id, null, { status: "cancelled" });
    return mapLeave(data);
  },
};
