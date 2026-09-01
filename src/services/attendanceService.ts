import {
  attendance as fixtureAttendance,
  attendanceCorrections as fixtureCorrections,
  attendanceTrend as fixtureTrend,
  shifts as fixtureShifts,
} from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { indiaDateKey, indiaDateKeyDaysAgo } from "@/lib/format";
import type { AttendanceCorrection, AttendanceRecord, Shift, TrendPoint } from "@/types";
import { fromFixture, matchesSearch, requireEmployeeId, requireOrganizationId, type QueryOptions } from "./api";

function mapAttendance(row: any): AttendanceRecord {
    return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employees ? `${row.employees.first_name} ${row.employees.last_name}` : "",
    date: row.attendance_date,
    checkIn: row.check_in,
    checkOut: row.check_out,
    workedHours: Number(row.worked_hours ?? 0),
    overtimeHours: Number(row.overtime_hours ?? 0),
    status: row.status,
    shift: row.shifts?.name ?? "",
    source: row.source,
    note: row.remarks ?? undefined,
  };
}
function mapShift(row: any): Shift {
  return {
    id: row.id,
    name: row.name,
    start: row.start_time,
    end: row.end_time,
    breakMinutes: row.break_minutes,
    graceMinutes: row.grace_minutes,
    weekOffs: [],
    assigned: 0,
    isNightShift: row.is_overnight,
  };
}

export const attendanceService = {
  async list(options: QueryOptions = {}): Promise<AttendanceRecord[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureAttendance.filter(
          (r) =>
            matchesSearch([r.employeeName, r.status, r.shift], options.search) &&
            (!options.status || options.status === "all" || r.status === options.status) &&
            (!options.employeeId || r.employeeId === options.employeeId),
        ),
      );
    let query = supabase
      .from("attendance_records")
      .select("*, employees(first_name,last_name), shifts(name)")
      .order("attendance_date", { ascending: false });
    if (options.employeeId) query = query.eq("employee_id", options.employeeId);
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapAttendance)
      .filter((r) => matchesSearch([r.employeeName, r.status, r.shift], options.search));
  },
  async today(employeeId: string): Promise<AttendanceRecord | null> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureAttendance.find((r) => r.employeeId === employeeId) ?? null);
    const resolved = await requireEmployeeId(employeeId);
    const today = indiaDateKey();
    const { data, error } = await supabase
      .from("attendance_records")
      .select("*, employees(first_name,last_name), shifts(name)")
      .eq("employee_id", resolved)
      .eq("attendance_date", today)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAttendance(data) : null;
  },
  async checkIn(employeeId: string, source: AttendanceRecord["source"] = "web") {
    return this.punch(employeeId, "check_in", source);
  },
  async checkOut(employeeId: string, source: AttendanceRecord["source"] = "web") {
    return this.punch(employeeId, "check_out", source);
  },
  async punch(
    employeeId: string,
    field: "check_in" | "check_out",
    source: AttendanceRecord["source"],
  ) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ employeeId, source, at: new Date().toISOString() });
    const resolved = await requireEmployeeId(employeeId);
    const date = indiaDateKey();
    const existing = await supabase
      .from("attendance_records")
      .select("id,check_in,check_out")
      .eq("employee_id", resolved)
      .eq("attendance_date", date)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (field === "check_in" && existing.data?.check_in) throw new Error("You are already checked in today.");
    if (field === "check_out" && !existing.data?.check_in) throw new Error("Check in before checking out.");
    if (field === "check_out" && existing.data?.check_out) throw new Error("You are already checked out today.");
    const now = new Date().toISOString();
    const request = existing.data
      ? field === "check_in"
        ? supabase
            .from("attendance_records")
            .update({ check_in: now, source, status: "present" })
            .eq("id", existing.data.id)
        : supabase
            .from("attendance_records")
            .update({ check_out: now, source, status: "present" })
            .eq("id", existing.data.id)
      : supabase.from("attendance_records").insert({
          employee_id: resolved,
          attendance_date: date,
          check_in: now,
          source,
          status: "present",
        });
    const { data, error } = await request.select().single();
    if (error) throw error;
    return data;
  },
  async corrections(): Promise<AttendanceCorrection[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureCorrections);
    const { data, error } = await supabase
      .from("attendance_corrections")
      .select("*, employees(first_name,last_name), attendance_records(attendance_date)");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
      date: r.attendance_records?.attendance_date ?? "",
      requested: [r.requested_check_in, r.requested_check_out].filter(Boolean).join(" – "),
      reason: r.reason,
      status: r.status,
    }));
  },
  async requestCorrection(payload: {
    employeeId: string;
    attendanceId: string;
    requestedCheckIn?: string;
    requestedCheckOut?: string;
    reason: string;
  }) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ ...payload, status: "pending" as const });
    if (!payload.attendanceId) throw new Error("Select the attendance record to correct.");
    if (!payload.requestedCheckIn && !payload.requestedCheckOut)
      throw new Error("Provide a requested check-in or check-out time.");
    if (!payload.reason.trim()) throw new Error("A reason is required.");
    const resolvedEmployeeId = await requireEmployeeId(payload.employeeId);
    const { data, error } = await supabase
      .from("attendance_corrections")
      .insert({
        employee_id: resolvedEmployeeId,
        attendance_id: payload.attendanceId,
        requested_check_in: payload.requestedCheckIn || null,
        requested_check_out: payload.requestedCheckOut || null,
        reason: payload.reason.trim(),
        status: "pending",
      })
      .select("*, employees(first_name,last_name), attendance_records(attendance_date)")
      .single();
    if (error) throw error;
    return data;
  },
  async shifts(): Promise<Shift[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureShifts);
    const { data, error } = await supabase.from("shifts").select("*").order("name");
    if (error) throw error;
    return (data ?? []).map(mapShift);
  },
  async createShift(input: {
    name: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    graceMinutes: number;
    isOvernight: boolean;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("shifts")
      .insert({
        organization_id: organizationId,
        name: input.name.trim(),
        start_time: input.startTime,
        end_time: input.endTime,
        break_minutes: input.breakMinutes,
        grace_minutes: input.graceMinutes,
        is_overnight: input.isOvernight,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  },
  async weeklyTrend(employeeId?: string): Promise<TrendPoint[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureTrend);
    let query = supabase
      .from("attendance_records")
      .select("attendance_date,status")
      .gte("attendance_date", indiaDateKeyDaysAgo(6));
    if (employeeId) query = query.eq("employee_id", employeeId);
    const { data, error } = await query;
    if (error) throw error;
    const grouped = new Map<string, TrendPoint>();
    (data ?? []).forEach((r: any) => {
      const label = r.attendance_date;
      const point = grouped.get(label) ?? { label, present: 0, absent: 0, wfh: 0 };
      if (r.status === "wfh") point.wfh++;
      else if (r.status === "absent") point.absent++;
      else point.present++;
      grouped.set(label, point);
    });
    return [...grouped.values()];
  },
};
