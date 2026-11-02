import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * Organisation-wide work-report rollup for the Org Overview page.
 *
 * Backed by `org_work_report_rollup(p_from, p_to)`, a SECURITY INVOKER
 * function, so each caller only aggregates rows RLS already lets them read:
 * a General Manager, Super Admin or HR sees everyone; a lead sees their scope.
 */
export interface WorkReportRollupRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  submitted: number;
  late: number;
  missed: number;
  drafts: number;
  approved: number;
  needsRevision: number;
  pendingReview: number;
  avgLeadRating: number | null;
  totalHours: number;
  lastReportDate: string | null;
}

type LooseRow = Record<string, unknown>;

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function rpcClient() {
  if (!isSupabaseConfigured || !supabase) return null;
  return supabase as unknown as {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  };
}

export function mapRollupRow(row: LooseRow): WorkReportRollupRow {
  return {
    employeeId: text(row["employee_id"]),
    employeeName: text(row["employee_name"], "Employee"),
    employeeCode: text(row["employee_code"]),
    departmentName: text(row["department_name"], "Unassigned"),
    submitted: num(row["submitted_count"]) ?? 0,
    late: num(row["late_count"]) ?? 0,
    missed: num(row["missed_count"]) ?? 0,
    drafts: num(row["draft_count"]) ?? 0,
    approved: num(row["approved_count"]) ?? 0,
    needsRevision: num(row["needs_revision_count"]) ?? 0,
    pendingReview: num(row["pending_review_count"]) ?? 0,
    avgLeadRating: num(row["avg_lead_rating"]),
    totalHours: num(row["total_hours"]) ?? 0,
    lastReportDate: text(row["last_report_date"]) || null,
  };
}

/** Filed reports (on time + late) as a share of reports that were due (filed + missed). */
export function filingRate(row: Pick<WorkReportRollupRow, "submitted" | "late" | "missed">) {
  const due = row.submitted + row.late + row.missed;
  return due === 0 ? null : ((row.submitted + row.late) / due) * 100;
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM period. */
export function periodBounds(period: string): { from: string; to: string } {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

export const orgOverviewService = {
  async workRollup(from: string, to: string): Promise<WorkReportRollupRow[]> {
    const db = rpcClient();
    if (!db) return [];
    const { data, error } = await db.rpc("org_work_report_rollup", { p_from: from, p_to: to });
    if (error) throw new Error(error.message ?? "Could not load the work-report rollup.");
    return Array.isArray(data) ? (data as LooseRow[]).map(mapRollupRow) : [];
  },
};
