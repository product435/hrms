import {
  attendance as fixtureAttendance,
  attendanceCorrections as fixtureCorrections,
  attendanceTrend as fixtureTrend,
  shifts as fixtureShifts,
} from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { AttendanceCorrection, AttendanceRecord, Shift, TrendPoint } from "@/types";
import { fromFixture, matchesSearch, requireEmployeeId, type QueryOptions } from "./api";

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
    const { data, error } = await supabase
      .from("attendance_records")
      .select("*, employees(first_name,last_name), shifts(name)")
      .eq("employee_id", resolved)
      .eq("attendance_date", new Date().toISOString().slice(0, 10))
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
    const date = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("attendance_records")
      .upsert({
        employee_id: resolved,
        attendance_date: date,
        source,
        status: "present",
        ...(field === "check_in" ? { check_in: now } : { check_out: now }),
      })
      .select()
      .single();
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
  async requestCorrection(payload: { date: string; requested: string; reason: string }) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ ...payload, status: "pending" as const });
    const resolvedEmployeeId = await requireEmployeeId();
    const { data, error } = await supabase
      .from("attendance_corrections")
      .insert({ employee_id: resolvedEmployeeId, reason: payload.reason })
      .select()
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
  async weeklyTrend(): Promise<TrendPoint[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureTrend);
    const { data, error } = await supabase
      .from("attendance_records")
      .select("attendance_date,status")
      .gte("attendance_date", new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
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
