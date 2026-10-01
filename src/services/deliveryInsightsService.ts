import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export const AI_PROMPT_VERSION = "v1";

export interface TaskMetrics {
  dueInPeriod: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
  openPastDue: number;
  openNotYetDue: number;
  medianDaysLate: number | null;
  onTimeRate: number | null;
  completionRate: number | null;
  createdWithoutDueDate: number;
}

export interface DwrMetrics {
  expectedDays: number;
  excusedDays: number;
  submittedOnTime: number;
  submittedLate: number;
  missed: number;
  submissionRate: number | null;
  onTimeShare: number | null;
  submittedReportsInPeriod: number;
}

export interface ProjectMetrics {
  projectId: string | null;
  projectName: string;
  assigned: number;
  onTime: number;
  late: number;
  openOverdue: number;
}

export interface DeliveryMetrics {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  tasks: TaskMetrics;
  dwr: DwrMetrics;
  byProject: ProjectMetrics[];
}

export interface AiScores {
  delivery: number;
  consistency: number;
  communication: number;
  blockerResolution: number;
}

export interface AiAnalysis {
  id: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  status: "ok" | "insufficient_data";
  model: string | null;
  scores: AiScores | null;
  summary: string;
  strengths: string[];
  risks: string[];
  tokensUsed: number;
  inputHash: string;
  createdAt: string;
}

export type AnalyzeOutcome = "analyzed" | "cached" | "insufficient_data" | "failed";

export interface AnalyzeResult {
  outcome: AnalyzeOutcome;
  analysis: AiAnalysis | null;
  error: string | null;
}

type Row = Record<string, unknown>;

function database() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.");
  }
  /* eslint-disable @typescript-eslint/no-explicit-any -- generated Database types do not know these tables */
  return supabase as unknown as {
    from: (t: string) => any;
    rpc: (fn: string, args?: Record<string, unknown>) => any;
    functions: {
      invoke: (name: string, options: { body: unknown }) => Promise<{ data: any; error: any }>;
    };
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (value: unknown) => (value == null ? null : num(value));

function mapMetrics(raw: Row): DeliveryMetrics {
  const tasks = (raw["tasks"] ?? {}) as Row;
  const dwr = (raw["dwr"] ?? {}) as Row;
  const byProject = Array.isArray(raw["by_project"]) ? (raw["by_project"] as Row[]) : [];
  return {
    employeeId: String(raw["employee_id"] ?? ""),
    periodStart: String(raw["period_start"] ?? ""),
    periodEnd: String(raw["period_end"] ?? ""),
    tasks: {
      dueInPeriod: num(tasks["due_in_period"]),
      completed: num(tasks["completed"]),
      completedOnTime: num(tasks["completed_on_time"]),
      completedLate: num(tasks["completed_late"]),
      openPastDue: num(tasks["open_past_due"]),
      openNotYetDue: num(tasks["open_not_yet_due"]),
      medianDaysLate: numOrNull(tasks["median_days_late"]),
      onTimeRate: numOrNull(tasks["on_time_rate"]),
      completionRate: numOrNull(tasks["completion_rate"]),
      createdWithoutDueDate: num(tasks["created_without_due_date"]),
    },
    dwr: {
      expectedDays: num(dwr["expected_days"]),
      excusedDays: num(dwr["excused_days"]),
      submittedOnTime: num(dwr["submitted_on_time"]),
      submittedLate: num(dwr["submitted_late"]),
      missed: num(dwr["missed"]),
      submissionRate: numOrNull(dwr["submission_rate"]),
      onTimeShare: numOrNull(dwr["on_time_share"]),
      submittedReportsInPeriod: num(dwr["submitted_reports_in_period"]),
    },
    byProject: byProject.map((p) => ({
      projectId: (p["project_id"] as string | null) ?? null,
      projectName: String(p["project_name"] ?? "No project"),
      assigned: num(p["assigned"]),
      onTime: num(p["on_time"]),
      late: num(p["late"]),
      openOverdue: num(p["open_overdue"]),
    })),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function mapAnalysis(row: Row): AiAnalysis {
  const scores = row["scores"] as Row | null;
  return {
    id: String(row["id"] ?? ""),
    employeeId: String(row["employee_id"] ?? ""),
    periodStart: String(row["period_start"] ?? ""),
    periodEnd: String(row["period_end"] ?? ""),
    status: row["status"] === "insufficient_data" ? "insufficient_data" : "ok",
    model: (row["model"] as string | null) ?? null,
    scores: scores
      ? {
          delivery: num(scores["delivery"]),
          consistency: num(scores["consistency"]),
          communication: num(scores["communication"]),
          blockerResolution: num(scores["blocker_resolution"]),
        }
      : null,
    summary: String(row["summary_text"] ?? ""),
    strengths: strings(row["strengths"]),
    risks: strings(row["risks"]),
    tokensUsed: num(row["tokens_used"]),
    inputHash: String(row["input_hash"] ?? ""),
    createdAt: String(row["created_at"] ?? ""),
  };
}

async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error.message : "The analysis request failed.";
}

export const deliveryInsightsService = {
  async metrics(employeeId: string, from: string, to: string): Promise<DeliveryMetrics> {
    const db = database();
    const { data, error } = await db.rpc("project_delivery_metrics", {
      p_employee_id: employeeId,
      p_from: from,
      p_to: to,
    });
    if (error) throw error;
    return mapMetrics((data ?? {}) as Row);
  },

  async latestAnalysis(employeeId: string, from: string, to: string): Promise<AiAnalysis | null> {
    const db = database();
    const { data, error } = await db
      .from("dwr_ai_analyses")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("period_start", from)
      .eq("period_end", to)
      .eq("prompt_version", AI_PROMPT_VERSION)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAnalysis(data as Row) : null;
  },

  /** Calls the analyze-dwr Edge Function. The OpenAI key never reaches the browser. */
  async analyze(employeeId: string, from: string, to: string): Promise<AnalyzeResult> {
    const db = database();
    const { data, error } = await db.functions.invoke("analyze-dwr", {
      body: { employee_id: employeeId, period_start: from, period_end: to },
    });
    if (error) throw new Error(await functionErrorMessage(error));
    const first = (data?.results?.[0] ?? null) as {
      outcome?: AnalyzeOutcome;
      analysis?: Row;
      error?: string;
    } | null;
    if (!first) throw new Error("The analysis returned no result.");
    return {
      outcome: first.outcome ?? "failed",
      analysis: first.analysis ? mapAnalysis(first.analysis) : null,
      error: first.error ?? null,
    };
  },
};
