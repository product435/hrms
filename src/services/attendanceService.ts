import {
  attendance as fixtureAttendance,
  attendanceCorrections as fixtureCorrections,
  attendanceTrend as fixtureTrend,
  shifts as fixtureShifts,
} from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { INDIA_TIME_ZONE, indiaDateKey, indiaDateKeyDaysAgo } from "@/lib/format";
import type { AttendanceRecord, AttendanceStatus, RequestStatus, Shift, TrendPoint } from "@/types";
import type {
  AttendanceCalendarDay,
  AttendanceCorrectionView,
  AttendancePolicy,
  CalendarDayStatus,
  Holiday,
  TeamAttendanceRow,
} from "@/types/attendance";
import {
  fromFixture,
  matchesSearch,
  requireEmployeeId,
  requireOrganizationId,
  type QueryOptions,
} from "./api";
import { workService } from "./workService";

const COMP_OFF_FLAG = "comp-off-eligible";
const MISSED_CHECKOUT_FLAG = "missed-checkout";
const DEFAULT_HALF_DAY_HOURS = 4;
const DEFAULT_REGULARIZATION_LIMIT = 3;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const db = supabase as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export type ShiftAssignee = {
  id: string;
  name: string;
  code: string;
  currentShiftId: string | null;
  currentShiftName: string;
  effectiveFrom: string | null;
};

type ShiftContext = {
  id: string;
  name: string;
  start: string;
  end: string;
  breakMinutes: number;
  graceMinutes: number;
  weekOffs: string[];
  isOvernight: boolean;
};

function field(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function textOf(value: unknown, fallback = "") {
  return value == null ? fallback : String(value);
}

function personName(value: unknown) {
  if (!value || typeof value !== "object") return "";
  return `${textOf(field(value, "first_name"))} ${textOf(field(value, "last_name"))}`.trim();
}

function mapAttendance(row: object): AttendanceRecord {
  const employees = field(row, "employees");
  const shift = field(row, "shifts");
  const shiftName = shift && typeof shift === "object" ? textOf(field(shift, "name")) : "";
  return {
    id: textOf(field(row, "id")),
    employeeId: textOf(field(row, "employee_id")),
    employeeName: employees ? personName(employees) : "",
    date: textOf(field(row, "attendance_date")),
    checkIn: field(row, "check_in") == null ? null : textOf(field(row, "check_in")),
    checkOut: field(row, "check_out") == null ? null : textOf(field(row, "check_out")),
    workedHours: Number(field(row, "worked_hours") ?? 0),
    overtimeHours: Number(field(row, "overtime_hours") ?? 0),
    status: textOf(field(row, "status")) as AttendanceStatus,
    shift: shiftName,
    source: textOf(field(row, "source"), "web") as AttendanceRecord["source"],
    ...(field(row, "remarks") == null ? {} : { note: textOf(field(row, "remarks")) }),
  };
}

function mapShift(row: object, assignedByShift?: Map<string, number>): Shift {
  const weekOffs = field(row, "week_offs");
  const id = textOf(field(row, "id"));
  const start = textOf(field(row, "start_time"));
  const end = textOf(field(row, "end_time"));
  return {
    id,
    name: textOf(field(row, "name")),
    start,
    end,
    breakMinutes: Number(field(row, "break_minutes") ?? 0),
    graceMinutes: Number(field(row, "grace_minutes") ?? 0),
    weekOffs: Array.isArray(weekOffs) ? weekOffs.map((day) => String(day)) : [],
    assigned: assignedByShift?.get(id) ?? 0,
    isNightShift: Boolean(field(row, "is_overnight")) || overnightFromTimes(start, end),
  };
}

function mapHoliday(row: object): Holiday {
  return {
    id: textOf(field(row, "id")),
    organizationId: textOf(field(row, "organization_id")),
    date: textOf(field(row, "date")),
    name: textOf(field(row, "name")),
    isOptional: Boolean(field(row, "is_optional")),
  };
}

function mapCorrection(row: object): AttendanceCorrectionView {
  const attendance = field(row, "attendance_records");
  const requested = [field(row, "requested_check_in"), field(row, "requested_check_out")]
    .filter((value) => value != null && value !== "")
    .map((value) => textOf(value));
  return {
    id: textOf(field(row, "id")),
    employeeId: textOf(field(row, "employee_id")),
    employeeName: personName(field(row, "employees")),
    date:
      attendance && typeof attendance === "object"
        ? textOf(field(attendance, "attendance_date"))
        : "",
    requested: requested.join(" – "),
    reason: textOf(field(row, "reason")),
    status: textOf(field(row, "status"), "pending") as RequestStatus,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOr(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePolicy(value: unknown, defaults: AttendancePolicy): AttendancePolicy {
  const bag = asRecord(value);
  return {
    halfDayHours: numberOr(bag["half_day_hours"], defaults.halfDayHours),
    regularizationMonthlyLimit: numberOr(
      bag["regularization_monthly_limit"],
      defaults.regularizationMonthlyLimit,
    ),
  };
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function overnightFromTimes(start: string, end: string) {
  if (!start.includes(":") || !end.includes(":")) return false;
  return timeToMinutes(end) <= timeToMinutes(start);
}

function istMinutesNow(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function weekdayKey(dateKey: string) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return WEEKDAY_KEYS[
    new Date(
      Date.UTC(
        Number.isFinite(year) ? year : 1970,
        (Number.isFinite(month) ? month : 1) - 1,
        Number.isFinite(day) ? day : 1,
      ),
    ).getUTCDay()
  ];
}

function isWeekOffDay(dateKey: string, weekOffs: string[]) {
  const key = weekdayKey(dateKey);
  return weekOffs.some((day) => day.trim().toLowerCase().slice(0, 3) === key);
}

function weekOffsFromWorkingDays(days: string[]) {
  if (!days.length) return [];
  const working = new Set(days.map((day) => day.trim().toLowerCase().slice(0, 3)));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].filter(
    (day) => !working.has(day.toLowerCase().slice(0, 3)),
  );
}

function coversDate(start: string | null, end: string | null, date: string) {
  return Boolean(start && end && date >= start && date <= end);
}

function assignedShiftId(
  employeeId: string,
  date: string,
  fallback: string | null,
  rows: Array<{
    employee_id: string | null;
    shift_id: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }>,
) {
  const match = rows
    .filter(
      (row) =>
        row.employee_id === employeeId &&
        row.shift_id &&
        (!row.effective_from || row.effective_from <= date) &&
        (!row.effective_to || row.effective_to >= date),
    )
    .sort((a, b) => (b.effective_from ?? "").localeCompare(a.effective_from ?? ""))[0];
  return match?.shift_id ?? fallback;
}

function monthBounds(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("Use a YYYY-MM month.");
  const year = Number(match[1]);
  const mon = Number(match[2]);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = Array.from(
    { length: last },
    (_, index) => `${match[1]}-${match[2]}-${String(index + 1).padStart(2, "0")}`,
  );
  const start = days[0];
  const end = days[days.length - 1];
  if (!start || !end) throw new Error("Use a YYYY-MM month.");
  return { start, end, days };
}

function mapShiftContext(row: object): ShiftContext {
  const start = textOf(field(row, "start_time"), "09:00");
  const end = textOf(field(row, "end_time"), "18:00");
  const weekOffs = field(row, "week_offs");
  const overnight = Boolean(field(row, "is_overnight")) || overnightFromTimes(start, end);
  return {
    id: textOf(field(row, "id")),
    name: textOf(field(row, "name")),
    start,
    end,
    breakMinutes: Number(field(row, "break_minutes") ?? 0),
    graceMinutes: Number(field(row, "grace_minutes") ?? 0),
    weekOffs: Array.isArray(weekOffs) ? weekOffs.map((day) => String(day)) : [],
    isOvernight: overnight,
  };
}

function ensureClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function readPolicy(organizationId: string): Promise<AttendancePolicy> {
  const defaults: AttendancePolicy = {
    halfDayHours: DEFAULT_HALF_DAY_HOURS,
    regularizationMonthlyLimit: DEFAULT_REGULARIZATION_LIMIT,
  };
  const primary = await db
    .from("organization_settings")
    .select("attendance_policy")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!primary.error) return parsePolicy(primary.data?.attendance_policy, defaults);

  const secondary = await db
    .from("organization_settings")
    .select("payroll_settings")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!secondary.error) return parsePolicy(secondary.data?.payroll_settings, defaults);
  return defaults;
}

const CLOSED_EMPLOYMENT = new Set([
  "resigned",
  "terminated",
  "inactive",
  "pending_approval",
  "rejected",
  "exited",
]);

async function activeShiftId(employeeId: string, onDate: string) {
  const client = ensureClient();
  const assigned = await client
    .from("employee_shifts")
    .select("employee_id, shift_id, effective_from, effective_to")
    .eq("employee_id", employeeId);
  if (assigned.error) throw assigned.error;
  const shiftId = assignedShiftId(employeeId, onDate, null, assigned.data ?? []);
  if (shiftId) return shiftId;

  const employee = await client
    .from("employees")
    .select("shift_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (employee.error) throw employee.error;
  return employee.data?.shift_id ?? null;
}

async function loadShift(employeeId: string, onDate: string): Promise<ShiftContext | null> {
  const shiftId = await activeShiftId(employeeId, onDate);
  if (!shiftId) return null;
  const rich = await db
    .from("shifts")
    .select("id,name,start_time,end_time,break_minutes,grace_minutes,is_overnight,week_offs")
    .eq("id", shiftId)
    .maybeSingle();
  if (!rich.error && rich.data) return mapShiftContext(rich.data);

  const basic = await ensureClient()
    .from("shifts")
    .select("id,name,start_time,end_time,break_minutes,grace_minutes,is_overnight")
    .eq("id", shiftId)
    .maybeSingle();
  if (basic.error) throw basic.error;
  return basic.data ? mapShiftContext(basic.data) : null;
}

async function organizationWeekOffs(organizationId: string | null | undefined) {
  if (!organizationId) return [];
  const settings = await ensureClient()
    .from("organization_settings")
    .select("working_days")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (settings.error || !settings.data) return [];
  return weekOffsFromWorkingDays(settings.data.working_days ?? []);
}

async function loadWorkRules(employeeId: string, onDate: string): Promise<ShiftContext | null> {
  const shift = await loadShift(employeeId, onDate);
  if (shift && shift.weekOffs.length) return shift;
  const client = ensureClient();
  const employee = await client
    .from("employees")
    .select("organization_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (employee.error) throw employee.error;
  const organizationId = employee.data?.organization_id;
  if (!organizationId) return shift;
  const settings = await client
    .from("organization_settings")
    .select("work_start_time, work_end_time, working_days")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (settings.error || !settings.data) return shift;
  const derivedOffs = weekOffsFromWorkingDays(settings.data.working_days ?? []);
  if (shift) return { ...shift, weekOffs: shift.weekOffs.length ? shift.weekOffs : derivedOffs };
  return mapShiftContext({
    id: "",
    name: "General",
    start_time: settings.data.work_start_time ?? "09:00",
    end_time: settings.data.work_end_time ?? "18:00",
    break_minutes: 0,
    grace_minutes: 0,
    is_overnight: false,
    week_offs: derivedOffs,
  });
}

async function datedWeekOffs(employeeId: string) {
  const client = ensureClient();
  const person = await client
    .from("employees")
    .select("shift_id, organization_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (person.error) throw person.error;
  const assignments = await client
    .from("employee_shifts")
    .select("employee_id, shift_id, effective_from, effective_to")
    .eq("employee_id", employeeId);
  if (assignments.error) throw assignments.error;
  const catalog = await db.from("shifts").select("id, week_offs");
  const weekOffsByShift = new Map<string, string[]>();
  if (!catalog.error) {
    for (const row of catalog.data ?? []) {
      const offs = field(row, "week_offs");
      weekOffsByShift.set(
        textOf(field(row, "id")),
        Array.isArray(offs) ? offs.map((day) => String(day)) : [],
      );
    }
  }
  const orgOffs = await organizationWeekOffs(person.data?.organization_id ?? null);
  const fallback = person.data?.shift_id ?? null;
  const rows = assignments.data ?? [];
  return (date: string) => {
    const shiftId = assignedShiftId(employeeId, date, fallback, rows);
    const offs = shiftId ? weekOffsByShift.get(shiftId) : undefined;
    if (offs && offs.length) return offs;
    return orgOffs;
  };
}

async function currentAssignmentCounts() {
  const today = indiaDateKey();
  const map = new Map<string, number>();
  const counted = await db.rpc("shift_assigned_counts", { p_on: today });
  if (!counted.error && Array.isArray(counted.data)) {
    for (const row of counted.data as Array<Record<string, unknown>>) {
      const id = textOf(row["shift_id"]);
      if (!id) continue;
      map.set(id, Number(row["assigned"] ?? 0));
    }
    return map;
  }

  const client = ensureClient();
  const [people, assignments] = await Promise.all([
    client.from("employees").select("id, shift_id, employment_status"),
    client.from("employee_shifts").select("employee_id, shift_id, effective_from, effective_to"),
  ]);
  if (people.error || assignments.error) return map;
  for (const person of people.data ?? []) {
    if (CLOSED_EMPLOYMENT.has(person.employment_status ?? "")) continue;
    const shiftId = assignedShiftId(person.id, today, person.shift_id, assignments.data ?? []);
    if (!shiftId) continue;
    map.set(shiftId, (map.get(shiftId) ?? 0) + 1);
  }
  return map;
}

async function holidayOn(organizationId: string, date: string) {
  const result = await db
    .from("holidays")
    .select("name,is_optional")
    .eq("organization_id", organizationId)
    .eq("date", date)
    .maybeSingle();
  if (result.error || !result.data) return null;
  return {
    name: String(result.data.name ?? "Holiday"),
    isOptional: Boolean(result.data.is_optional),
  };
}

async function resolvePunchDate(employeeId: string, shift: ShiftContext | null) {
  const client = ensureClient();
  const today = indiaDateKey();
  const yesterday = indiaDateKeyDaysAgo(1);
  const open = await client
    .from("attendance_records")
    .select("attendance_date,check_in,check_out")
    .eq("employee_id", employeeId)
    .in("attendance_date", [today, yesterday]);
  if (open.error) throw open.error;
  const pending = (open.data ?? []).find(
    (row) => row.check_in && !row.check_out && row.attendance_date,
  );
  if (pending?.attendance_date) return pending.attendance_date;

  if (shift?.isOvernight && shift.end && istMinutesNow() < timeToMinutes(shift.end))
    return yesterday;
  return today;
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const STATUS_CODE: Record<string, string> = {
  present: "P",
  late: "L",
  "half-day": "HD",
  wfh: "WFH",
  leave: "LV",
  holiday: "H",
  "week-off": "WO",
  absent: "A",
};

/**
 * DWR_GATE
 * Check-out uses the same IST attendance date as punch. Check-in is not gated.
 * Do not query or create daily_work_reports from this module.
 */
export async function assertCheckoutAllowed(employeeId: string): Promise<void> {
  const date =
    isSupabaseConfigured && supabase
      ? await resolvePunchDate(employeeId, await loadWorkRules(employeeId, indiaDateKey()))
      : indiaDateKey();
  const gate = await workService.checkoutAllowed(employeeId, date);
  if (!gate.allowed) {
    throw new Error(gate.reason ?? "Submit today's work report before checking out.");
  }
}

export const attendanceService = {
  async list(options: QueryOptions = {}): Promise<AttendanceRecord[]> {
    if (!isSupabaseConfigured || !supabase) {
      return fromFixture(
        fixtureAttendance.filter(
          (row) =>
            matchesSearch([row.employeeName, row.status, row.shift], options.search) &&
            (!options.status || options.status === "all" || row.status === options.status) &&
            (!options.employeeId || row.employeeId === options.employeeId) &&
            (!options.from || row.date >= options.from) &&
            (!options.to || row.date <= options.to),
        ),
      );
    }
    let query = supabase
      .from("attendance_records")
      .select("*, employees(first_name,last_name), shifts(name)")
      .order("attendance_date", { ascending: false });
    if (options.employeeId) query = query.eq("employee_id", options.employeeId);
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    if (options.from) query = query.gte("attendance_date", options.from);
    if (options.to) query = query.lte("attendance_date", options.to);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapAttendance)
      .filter((row) => matchesSearch([row.employeeName, row.status, row.shift], options.search));
  },

  async today(employeeId: string): Promise<AttendanceRecord | null> {
    if (!isSupabaseConfigured || !supabase) {
      return fromFixture(fixtureAttendance.find((row) => row.employeeId === employeeId) ?? null);
    }
    const resolved = await requireEmployeeId(employeeId);
    const today = indiaDateKey();
    // Lock-day still uses the shift effective today to choose yesterday for an
    // open overnight window. Hours and late status then follow the assignment
    // effective on that attendance date.
    const todayShift = await loadWorkRules(resolved, today);
    const date = await resolvePunchDate(resolved, todayShift);
    const shift = date === today ? todayShift : await loadWorkRules(resolved, date);
    const { data, error } = await supabase
      .from("attendance_records")
      .select("*, employees(first_name,last_name), shifts(name)")
      .eq("employee_id", resolved)
      .eq("attendance_date", date)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const mapped = mapAttendance(data);
    if (mapped.shift || !shift?.name) return mapped;
    return { ...mapped, shift: shift.name };
  },

  async checkIn(employeeId: string, source: AttendanceRecord["source"] = "web") {
    return this.punch(employeeId, "check_in", source);
  },

  async checkOut(employeeId: string, source: AttendanceRecord["source"] = "web") {
    const resolved = await requireEmployeeId(employeeId);
    await assertCheckoutAllowed(resolved);
    return this.punch(resolved, "check_out", source);
  },

  async punch(
    employeeId: string,
    field: "check_in" | "check_out",
    source: AttendanceRecord["source"],
  ) {
    if (!isSupabaseConfigured || !supabase) {
      return fromFixture({ employeeId, source, at: new Date().toISOString() });
    }
    const resolved = await requireEmployeeId(employeeId);
    const { data, error } = await db.rpc("punch_attendance", {
      p_employee_id: resolved,
      p_action: field,
    });
    if (error) throw error;
    return data;
  },

  async requestWfh(employeeId: string, reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("A reason is required for work from home.");
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ employeeId, status: "wfh" as const, reason: trimmed });

    const resolved = await requireEmployeeId(employeeId);
    const { data, error } = await db.rpc("request_work_from_home", {
      p_employee_id: resolved,
      p_reason: trimmed,
    });
    if (error) throw error;
    return data;
  },

  async corrections(): Promise<AttendanceCorrectionView[]> {
    if (!isSupabaseConfigured || !supabase) {
      return fromFixture(fixtureCorrections.map((row) => ({ ...row, employeeId: "" })));
    }
    const { data, error } = await supabase
      .from("attendance_corrections")
      .select("*, employees(first_name,last_name), attendance_records(attendance_date)")
      .order("status", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapCorrection);
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
    if (!payload.requestedCheckIn && !payload.requestedCheckOut) {
      throw new Error("Provide a requested check-in or check-out time.");
    }
    if (!payload.reason.trim()) throw new Error("A reason is required.");
    await requireEmployeeId(payload.employeeId);

    const created = await db.rpc("request_attendance_regularization", {
      p_attendance_id: payload.attendanceId,
      p_requested_check_in: payload.requestedCheckIn || null,
      p_requested_check_out: payload.requestedCheckOut || null,
      p_reason: payload.reason.trim(),
    });
    if (created.error) throw created.error;

    const { data, error } = await supabase
      .from("attendance_corrections")
      .select("*, employees(first_name,last_name), attendance_records(attendance_date)")
      .eq("id", created.data)
      .single();
    if (error) throw error;
    return data;
  },

  async decideCorrection(correctionId: string, decision: "approved" | "rejected") {
    if (!isSupabaseConfigured || !supabase) {
      await fromFixture({ correctionId, decision });
      return;
    }
    const { error } = await db.rpc("decide_attendance_correction", {
      p_correction_id: correctionId,
      p_decision: decision,
    });
    if (error) throw error;
  },

  async policy(): Promise<AttendancePolicy> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        halfDayHours: DEFAULT_HALF_DAY_HOURS,
        regularizationMonthlyLimit: DEFAULT_REGULARIZATION_LIMIT,
      };
    }
    const organizationId = await requireOrganizationId();
    return readPolicy(organizationId);
  },

  async shifts(): Promise<Shift[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureShifts);
    const counts = await currentAssignmentCounts();
    const rich = await db.from("shifts").select("*").order("name");
    if (!rich.error) return (rich.data ?? []).map((row: object) => mapShift(row, counts));
    const { data, error } = await supabase.from("shifts").select("*").order("name");
    if (error) throw error;
    return (data ?? []).map((row) => mapShift(row, counts));
  },

  async createShift(input: {
    name: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    graceMinutes: number;
    isOvernight: boolean;
    weekOffs?: string[];
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const overnight = input.isOvernight || overnightFromTimes(input.startTime, input.endTime);
    const { data, error } = await supabase
      .from("shifts")
      .insert({
        organization_id: organizationId,
        name: input.name.trim(),
        start_time: input.startTime,
        end_time: input.endTime,
        break_minutes: input.breakMinutes,
        grace_minutes: input.graceMinutes,
        is_overnight: overnight,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    const weekOffs = input.weekOffs ?? [];
    const saved = await db.from("shifts").update({ week_offs: weekOffs }).eq("id", data.id);
    if (saved.error) throw saved.error;
    return data;
  },

  async updateShiftWeekOffs(shiftId: string, weekOffs: string[]) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await db.from("shifts").update({ week_offs: weekOffs }).eq("id", shiftId);
    if (error) throw error;
  },

  async shiftAssignees(): Promise<ShiftAssignee[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const today = indiaDateKey();
    const client = ensureClient();
    const [people, assignments, shifts] = await Promise.all([
      client
        .from("employees")
        .select("id, first_name, last_name, employee_code, employment_status, shift_id")
        .order("first_name"),
      client.from("employee_shifts").select("employee_id, shift_id, effective_from, effective_to"),
      client.from("shifts").select("id, name"),
    ]);
    if (people.error) throw people.error;
    if (assignments.error) throw assignments.error;
    if (shifts.error) throw shifts.error;
    const names = new Map(
      (shifts.data ?? []).map((shift) => [textOf(shift.id), textOf(shift.name)]),
    );
    const rows = assignments.data ?? [];
    return (people.data ?? [])
      .filter((person) => !CLOSED_EMPLOYMENT.has(person.employment_status ?? ""))
      .map((person) => {
        const covering = rows
          .filter(
            (row) =>
              row.employee_id === person.id &&
              row.shift_id &&
              (!row.effective_from || row.effective_from <= today) &&
              (!row.effective_to || row.effective_to >= today),
          )
          .sort((a, b) => (b.effective_from ?? "").localeCompare(a.effective_from ?? ""))[0];
        const currentShiftId = covering?.shift_id ?? person.shift_id ?? null;
        return {
          id: person.id,
          name: `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "Employee",
          code: person.employee_code ?? "",
          currentShiftId,
          currentShiftName: currentShiftId ? (names.get(currentShiftId) ?? "") : "",
          effectiveFrom: covering?.effective_from ?? null,
        };
      });
  },

  async assignEmployeeShift(input: {
    employeeId: string;
    shiftId: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    if (!input.employeeId) throw new Error("Choose an employee.");
    if (!input.shiftId) throw new Error("Choose a shift.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
      throw new Error("Effective from must be a date.");
    }
    const effectiveTo = input.effectiveTo?.trim() ? input.effectiveTo.trim() : null;
    if (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
      throw new Error("Effective to must be a date.");
    }
    if (effectiveTo && effectiveTo < input.effectiveFrom) {
      throw new Error("Effective to must be on or after effective from.");
    }
    const { data, error } = await db.rpc("assign_employee_shift", {
      p_employee_id: input.employeeId,
      p_shift_id: input.shiftId,
      p_effective_from: input.effectiveFrom,
      p_effective_to: effectiveTo,
    });
    if (error) throw error;
    return data;
  },

  async holidays(range?: { from: string; to: string }): Promise<Holiday[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture([]);
    const organizationId = await requireOrganizationId();
    let query = db
      .from("holidays")
      .select("id,organization_id,date,name,is_optional")
      .eq("organization_id", organizationId)
      .order("date");
    if (range?.from) query = query.gte("date", range.from);
    if (range?.to) query = query.lte("date", range.to);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map(mapHoliday);
  },

  async saveHoliday(input: { date: string; name: string; isOptional: boolean }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const name = input.name.trim();
    if (!name) throw new Error("Holiday name is required.");
    if (!input.date) throw new Error("Holiday date is required.");
    const organizationId = await requireOrganizationId();
    const { data, error } = await db
      .from("holidays")
      .upsert(
        {
          organization_id: organizationId,
          date: input.date,
          name,
          is_optional: input.isOptional,
        },
        { onConflict: "organization_id,date" },
      )
      .select("id,organization_id,date,name,is_optional")
      .single();
    if (error) throw error;
    return mapHoliday(data);
  },

  async deleteHoliday(id: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await db.from("holidays").delete().eq("id", id);
    if (error) throw error;
  },

  async calendar(employeeId: string, month: string): Promise<AttendanceCalendarDay[]> {
    const { start, end, days } = monthBounds(month);
    if (!isSupabaseConfigured || !supabase) {
      return fromFixture(
        days.map((date) => {
          const row = fixtureAttendance.find(
            (item) => item.employeeId === employeeId && item.date === date,
          );
          if (!row) return { date, status: "unmarked" as const };
          return {
            date,
            status: row.status,
            ...(row.note != null ? { note: row.note } : {}),
            workedHours: row.workedHours,
            compOffEligible: false,
            missedCheckout: false,
          };
        }),
      );
    }

    const resolved = await requireEmployeeId(employeeId);
    const weekOffsOn = await datedWeekOffs(resolved);
    const records = await supabase
      .from("attendance_records")
      .select("attendance_date,status,remarks,worked_hours")
      .eq("employee_id", resolved)
      .gte("attendance_date", start)
      .lte("attendance_date", end);
    if (records.error) throw records.error;

    const leave = await supabase
      .from("leave_requests")
      .select("start_date,end_date,status")
      .eq("employee_id", resolved)
      .eq("status", "approved")
      .lte("start_date", end)
      .gte("end_date", start);
    if (leave.error) throw leave.error;

    const holidays = await this.holidays({ from: start, to: end });
    const holidayByDate = new Map(holidays.map((item) => [item.date, item]));
    const recordByDate = new Map(
      (records.data ?? []).map((row) => [row.attendance_date ?? "", row]),
    );

    return days.map((date) => {
      const row = recordByDate.get(date);
      const holiday = holidayByDate.get(date);
      const onLeave = (leave.data ?? []).some(
        (item) =>
          item.start_date && item.end_date && date >= item.start_date && date <= item.end_date,
      );
      if (row?.status) {
        const note = row.remarks == null ? undefined : String(row.remarks);
        return {
          date,
          status: row.status as CalendarDayStatus,
          ...(note != null ? { note } : {}),
          ...(row.worked_hours == null ? {} : { workedHours: Number(row.worked_hours) }),
          compOffEligible: String(note ?? "")
            .toLowerCase()
            .includes(COMP_OFF_FLAG),
          missedCheckout: String(note ?? "")
            .toLowerCase()
            .includes(MISSED_CHECKOUT_FLAG),
        };
      }
      if (onLeave) return { date, status: "leave" };
      if (holiday)
        return {
          date,
          status: "holiday",
          note: holiday.isOptional ? `${holiday.name} (optional)` : holiday.name,
        };
      if (isWeekOffDay(date, weekOffsOn(date))) return { date, status: "week-off" };
      return { date, status: "unmarked" };
    });
  },

  async teamBoard(date: string): Promise<TeamAttendanceRow[]> {
    if (!isSupabaseConfigured || !supabase) {
      return fromFixture(
        fixtureAttendance
          .filter((row) => row.date === date)
          .map((row) => ({
            employeeId: row.employeeId,
            employeeCode: "",
            employeeName: row.employeeName,
            status: row.status,
            checkIn: row.checkIn,
            checkOut: row.checkOut,
            shift: row.shift,
            ...(row.note != null ? { note: row.note } : {}),
          })),
      );
    }

    const people = await supabase
      .from("employees")
      .select("id,first_name,last_name,employee_code,employment_status,shift_id")
      .order("first_name");
    if (people.error) throw people.error;

    const punches = await this.list({ from: date, to: date });
    const punchByEmployee = new Map(punches.map((row) => [row.employeeId, row]));
    const assignments = await supabase
      .from("employee_shifts")
      .select("employee_id,shift_id,effective_from,effective_to");
    if (assignments.error) throw assignments.error;
    const leave = await supabase
      .from("leave_requests")
      .select("employee_id,start_date,end_date")
      .eq("status", "approved")
      .lte("start_date", date)
      .gte("end_date", date);
    if (leave.error) throw leave.error;
    const onLeave = new Set(
      (leave.data ?? [])
        .filter((row) => coversDate(row.start_date, row.end_date, date))
        .map((row) => row.employee_id),
    );
    const shifts = await this.shifts();
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    let holidayName: string | null = null;
    try {
      const organizationId = await requireOrganizationId();
      const holiday = await holidayOn(organizationId, date);
      holidayName = holiday
        ? holiday.isOptional
          ? `${holiday.name} (optional)`
          : holiday.name
        : null;
    } catch {
      holidayName = null;
    }

    return (people.data ?? [])
      .filter(
        (person) =>
          ![
            "resigned",
            "terminated",
            "inactive",
            "pending_approval",
            "rejected",
            "exited",
          ].includes(person.employment_status ?? ""),
      )
      .map((person) => {
        const name = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
        const punch = punchByEmployee.get(person.id);
        if (punch) {
          return {
            employeeId: person.id,
            employeeCode: person.employee_code ?? "",
            employeeName: name,
            status: punch.status,
            checkIn: punch.checkIn,
            checkOut: punch.checkOut,
            shift: punch.shift,
            ...(punch.note != null ? { note: punch.note } : {}),
          };
        }
        const shiftId = assignedShiftId(person.id, date, person.shift_id, assignments.data ?? []);
        const shift = shiftId ? shiftById.get(shiftId) : undefined;
        const weekOff = shift ? isWeekOffDay(date, shift.weekOffs) : false;
        const status = onLeave.has(person.id)
          ? "leave"
          : holidayName
            ? "holiday"
            : weekOff
              ? "week-off"
              : "unmarked";
        return {
          employeeId: person.id,
          employeeCode: person.employee_code ?? "",
          employeeName: name,
          status,
          checkIn: null,
          checkOut: null,
          shift: shift?.name ?? "",
          ...(holidayName != null ? { note: holidayName } : {}),
        };
      });
  },

  async musterCsv(month: string): Promise<string> {
    const { days } = monthBounds(month);
    const rows = await this.teamMonth(month);
    const header = [
      "Employee code",
      "Employee",
      ...days.map((date) => date.slice(8)),
      "Present",
      "Late",
      "Half-day",
      "WFH",
      "Leave",
      "Absent",
    ];
    const body = rows.map((row) => {
      const counts = { present: 0, late: 0, "half-day": 0, wfh: 0, leave: 0, absent: 0 };
      const cells = days.map((date) => {
        const status = row.days[date] ?? "";
        if (status in counts) counts[status as keyof typeof counts] += 1;
        return STATUS_CODE[status] ?? "";
      });
      return [
        row.employeeCode,
        row.employeeName,
        ...cells,
        String(counts.present),
        String(counts.late),
        String(counts["half-day"]),
        String(counts.wfh),
        String(counts.leave),
        String(counts.absent),
      ];
    });
    return [header, ...body].map((line) => line.map(csvCell).join(",")).join("\n");
  },

  async teamMonth(month: string): Promise<
    Array<{
      employeeId: string;
      employeeCode: string;
      employeeName: string;
      days: Record<string, string>;
    }>
  > {
    const { start, end, days } = monthBounds(month);
    if (!isSupabaseConfigured || !supabase) {
      const grouped = new Map<
        string,
        {
          employeeId: string;
          employeeCode: string;
          employeeName: string;
          days: Record<string, string>;
        }
      >();
      fixtureAttendance
        .filter((row) => row.date >= start && row.date <= end)
        .forEach((row) => {
          const current = grouped.get(row.employeeId) ?? {
            employeeId: row.employeeId,
            employeeCode: "",
            employeeName: row.employeeName,
            days: {},
          };
          current.days[row.date] = row.status;
          grouped.set(row.employeeId, current);
        });
      return fromFixture([...grouped.values()]);
    }

    const people = await supabase
      .from("employees")
      .select("id,first_name,last_name,employee_code,employment_status,shift_id")
      .order("first_name");
    if (people.error) throw people.error;
    const records = await this.list({ from: start, to: end });
    const assignments = await supabase
      .from("employee_shifts")
      .select("employee_id,shift_id,effective_from,effective_to");
    if (assignments.error) throw assignments.error;
    const leave = await supabase
      .from("leave_requests")
      .select("employee_id,start_date,end_date")
      .eq("status", "approved")
      .lte("start_date", end)
      .gte("end_date", start);
    if (leave.error) throw leave.error;
    const shifts = await this.shifts();
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    const holidays = await this.holidays({ from: start, to: end });
    const holidayDates = new Set(
      holidays.filter((item) => !item.isOptional).map((item) => item.date),
    );

    return (people.data ?? [])
      .filter(
        (person) =>
          ![
            "resigned",
            "terminated",
            "inactive",
            "pending_approval",
            "rejected",
            "exited",
          ].includes(person.employment_status ?? ""),
      )
      .map((person) => {
        const dayMap: Record<string, string> = {};
        days.forEach((date) => {
          const shiftId = assignedShiftId(person.id, date, person.shift_id, assignments.data ?? []);
          const shift = shiftId ? shiftById.get(shiftId) : undefined;
          const punch = records.find((row) => row.employeeId === person.id && row.date === date);
          const onLeave = (leave.data ?? []).some(
            (row) =>
              row.employee_id === person.id && coversDate(row.start_date, row.end_date, date),
          );
          if (punch) dayMap[date] = punch.status;
          else if (onLeave) dayMap[date] = "leave";
          else if (holidayDates.has(date)) dayMap[date] = "holiday";
          else if (shift && isWeekOffDay(date, shift.weekOffs)) dayMap[date] = "week-off";
        });
        return {
          employeeId: person.id,
          employeeCode: person.employee_code ?? "",
          employeeName: `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim(),
          days: dayMap,
        };
      });
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
    (data ?? []).forEach((row) => {
      const label = row.attendance_date;
      if (!label) return;
      const point = grouped.get(label) ?? { label, present: 0, absent: 0, wfh: 0 };
      if (row.status === "wfh") point.wfh++;
      else if (row.status === "absent") point.absent++;
      else point.present++;
      grouped.set(label, point);
    });
    return [...grouped.values()];
  },
};
