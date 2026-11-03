import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  isDbObjectKnownMissing,
  isMissingDbObject,
  markDbObjectMissing,
} from "@/lib/schema-features";

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
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
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

export interface WorkReportRollup {
  rows: WorkReportRollupRow[];
  /**
   * "database": org_work_report_rollup() did the counting.
   * "browser": that function is not installed yet (migration not applied),
   * so the same counts were built here from the rows RLS already returns.
   */
  source: "database" | "browser";
}

let rollupFunctionMissing = false;

const ACTIVE_STATUSES = new Set(["active", "probation", "notice", "on-leave"]);
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/* eslint-disable @typescript-eslint/no-explicit-any -- loose PostgREST builder for tables outside the generated types */
type TableClient = { from: (table: string) => any };
/* eslint-enable @typescript-eslint/no-explicit-any */

async function allRows(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
) {
  const out: LooseRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await build(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as LooseRow[]) : [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function one(value: unknown): LooseRow | null {
  if (Array.isArray(value)) return (value[0] as LooseRow | undefined) ?? null;
  return value && typeof value === "object" ? (value as LooseRow) : null;
}

/** Same counts as org_work_report_rollup(), computed client-side. */
async function rollupInBrowser(from: string, to: string): Promise<WorkReportRollupRow[]> {
  const db = supabase as unknown as TableClient;
  const [employees, reports] = await Promise.all([
    allRows((start, end) =>
      db
        .from("employees")
        .select(
          "id, first_name, last_name, employee_code, employment_status, departments!employees_department_id_fkey(name)",
        )
        .order("first_name")
        .range(start, end),
    ),
    allRows((start, end) =>
      db
        .from("daily_work_reports")
        .select("employee_id, report_date, status, review_status, lead_rating, total_hours")
        .gte("report_date", from)
        .lte("report_date", to)
        .order("report_date")
        .range(start, end),
    ),
  ]);

  const byEmployee = new Map<string, WorkReportRollupRow & { ratings: number[] }>();
  for (const employee of employees) {
    const status = text(employee["employment_status"], "active").toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) continue;
    const name = `${text(employee["first_name"])} ${text(employee["last_name"])}`.trim();
    byEmployee.set(text(employee["id"]), {
      employeeId: text(employee["id"]),
      employeeName: name || "Employee",
      employeeCode: text(employee["employee_code"]),
      departmentName: text(one(employee["departments"])?.["name"], "Unassigned"),
      submitted: 0,
      late: 0,
      missed: 0,
      drafts: 0,
      approved: 0,
      needsRevision: 0,
      pendingReview: 0,
      avgLeadRating: null,
      totalHours: 0,
      lastReportDate: null,
      ratings: [],
    });
  }

  for (const report of reports) {
    const row = byEmployee.get(text(report["employee_id"]));
    if (!row) continue;
    const status = text(report["status"]);
    const review = text(report["review_status"]);
    const filed = status === "submitted" || status === "late";
    if (status === "submitted") row.submitted += 1;
    if (status === "late") row.late += 1;
    if (status === "missed") row.missed += 1;
    if (status === "draft") row.drafts += 1;
    if (review === "approved") row.approved += 1;
    if (review === "needs-revision") row.needsRevision += 1;
    if (review === "pending" && filed) row.pendingReview += 1;
    const rating = num(report["lead_rating"]);
    if (rating != null) row.ratings.push(rating);
    if (filed) {
      row.totalHours += num(report["total_hours"]) ?? 0;
      const date = text(report["report_date"]);
      if (date && (!row.lastReportDate || date > row.lastReportDate)) row.lastReportDate = date;
    }
  }

  return [...byEmployee.values()]
    .map(({ ratings, ...row }) => ({
      ...row,
      avgLeadRating: ratings.length
        ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 100) / 100
        : null,
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export const orgOverviewService = {
  async workRollup(from: string, to: string): Promise<WorkReportRollup> {
    const db = rpcClient();
    if (!db) return { rows: [], source: "database" };
    if (rollupFunctionMissing || isDbObjectKnownMissing("org_work_report_rollup")) {
      return { rows: await rollupInBrowser(from, to), source: "browser" };
    }
    const { data, error } = await db.rpc("org_work_report_rollup", { p_from: from, p_to: to });
    if (error) {
      if (isMissingDbObject(error)) {
        // Not installed yet: skip the round trip for the rest of this page load.
        rollupFunctionMissing = true;
        markDbObjectMissing("org_work_report_rollup");
        return { rows: await rollupInBrowser(from, to), source: "browser" };
      }
      throw new Error(error.message ?? "Could not load the work-report rollup.");
    }
    return {
      rows: Array.isArray(data) ? (data as LooseRow[]).map(mapRollupRow) : [],
      source: "database",
    };
  },
};
