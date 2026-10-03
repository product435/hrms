import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { DEFAULT_SHIFT } from "@/lib/dwr-window";
import type {
  AssignTaskInput,
  CheckoutAllowed,
  DailyWorkReport,
  DirectoryEmployee,
  DwrItem,
  DwrItemStatus,
  DwrReviewStatus,
  DwrStatus,
  MyWorkContext,
  Project,
  SaveReportInput,
  SaveSummaryInput,
  TaskComment,
  TaskPriority,
  TaskStatus,
  TeamDailySummary,
  WorkTask,
} from "@/types/work";
import { requireEmployeeId, requireOrganizationId } from "./api";

const CHECKOUT_MISSING_REASON = "Submit today's work report before check-out.";

function database() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.");
  }
  /* eslint-disable @typescript-eslint/no-explicit-any -- generated Database types do not know these tables */
  const db = supabase as unknown as {
    from: (t: string) => any;
    rpc: (fn: string, args?: Record<string, unknown>) => any;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return db;
}

interface LooseRow {
  id?: string;
  name?: string | null;
  is_active?: boolean | null;
  project_id?: string | null;
  projects?: { name?: string | null } | null;
  assigned_by?: string | null;
  assigner?: { first_name?: string | null; last_name?: string | null } | null;
  assigned_to?: string;
  assignee?: { first_name?: string | null; last_name?: string | null } | null;
  title?: string | null;
  description?: string | null;
  description_html?: string | null;
  priority?: TaskPriority | null;
  due_date?: string | null;
  estimated_hours?: number | null;
  status?: string | null;
  completed_at?: string | null;
  task_id?: string | null;
  author_id?: string | null;
  author?: { first_name?: string | null; last_name?: string | null } | null;
  body?: string | null;
  created_at?: string | null;
  task_id_ref?: string | null;
  hours?: number | null;
  item_status?: DwrItemStatus | null;
  employee_id?: string;
  employees?: { first_name?: string | null; last_name?: string | null } | null;
  report_date?: string;
  submitted_at?: string | null;
  total_hours?: number | null;
  blockers?: string | null;
  plan_for_tomorrow?: string | null;
  summary_html?: string | null;
  is_unplanned?: boolean | null;
  review_status?: DwrReviewStatus | null;
  lead_rating?: number | null;
  lead_remarks?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  escalated?: boolean | null;
  reopen_reason?: string | null;
  waiver_reason?: string | null;
  dwr_items?: LooseRow[] | null;
  lead_employee_id?: string;
  lead?: { first_name?: string | null; last_name?: string | null } | null;
  department_id?: string | null;
  departments?: { name?: string | null } | null;
  summary?: string | null;
  highlights?: string | null;
  risks?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  shift_id?: string | null;
  organization_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_overnight?: boolean | null;
}

function personName(
  row: { first_name?: string | null; last_name?: string | null } | null | undefined,
): string {
  if (!row || Array.isArray(row)) return "";
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
}

function mapProject(row: LooseRow): Project {
  return { id: row.id ?? "", name: row.name ?? "", isActive: Boolean(row.is_active) };
}

function mapTask(row: LooseRow): WorkTask {
  return {
    id: row.id ?? "",
    projectId: row.project_id ?? null,
    projectName: row.projects?.name ?? "",
    assignedBy: row.assigned_by ?? null,
    assignedByName: personName(row.assigner),
    assignedTo: row.assigned_to ?? "",
    assignedToName: personName(row.assignee),
    title: row.title ?? "",
    description: row.description ?? "",
    priority: (row.priority ?? "medium") as TaskPriority,
    dueDate: row.due_date ?? null,
    estimatedHours: row.estimated_hours == null ? null : Number(row.estimated_hours),
    status: (row.status ?? "todo") as TaskStatus,
    completedAt: row.completed_at ?? null,
  };
}

function mapComment(row: LooseRow): TaskComment {
  return {
    id: row.id ?? "",
    taskId: row.task_id ?? "",
    authorId: row.author_id ?? null,
    authorName: personName(row.author),
    body: row.body ?? "",
    createdAt: row.created_at ?? "",
  };
}

function mapItem(row: LooseRow): DwrItem {
  return {
    id: row.id ?? "",
    taskId: row.task_id ?? null,
    description: row.description ?? "",
    descriptionHtml: row.description_html ?? "",
    hours: Number(row.hours ?? 0),
    itemStatus: (row.item_status ?? "done") as DwrItemStatus,
    isUnplanned: Boolean(row.is_unplanned),
  };
}

function mapReport(row: LooseRow): DailyWorkReport {
  const items = Array.isArray(row.dwr_items) ? row.dwr_items : [];
  return {
    id: row.id ?? "",
    employeeId: row.employee_id ?? "",
    employeeName: personName(row.employees),
    reportDate: row.report_date ?? "",
    status: (row.status ?? "draft") as DwrStatus,
    submittedAt: row.submitted_at ?? null,
    totalHours: Number(row.total_hours ?? 0),
    blockers: row.blockers ?? "",
    planForTomorrow: row.plan_for_tomorrow ?? "",
    summaryHtml: row.summary_html ?? "",
    reviewStatus: (row.review_status ?? "pending") as DwrReviewStatus,
    leadRating: row.lead_rating == null ? null : Number(row.lead_rating),
    leadRemarks: row.lead_remarks ?? "",
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    escalated: Boolean(row.escalated),
    reopenReason: row.reopen_reason ?? "",
    waiverReason: row.waiver_reason ?? "",
    items: items.map(mapItem),
  };
}

function mapSummary(row: LooseRow): TeamDailySummary {
  return {
    id: row.id ?? "",
    leadEmployeeId: row.lead_employee_id ?? "",
    leadName: personName(row.lead),
    departmentId: row.department_id ?? null,
    departmentName: row.departments?.name ?? "",
    reportDate: row.report_date ?? "",
    summary: row.summary ?? "",
    highlights: row.highlights ?? "",
    risks: row.risks ?? "",
  };
}

function itemPayload(items: SaveReportInput["items"]) {
  return items.map((item) => ({
    task_id: item.taskId,
    description: item.description,
    hours: item.hours,
    item_status: item.itemStatus,
    is_unplanned: item.isUnplanned && !item.taskId,
  }));
}

const TASK_SELECT =
  "id, organization_id, project_id, assigned_by, assigned_to, title, description, priority, due_date, estimated_hours, status, completed_at, projects(name), assignee:employees!tasks_assigned_to_fkey(first_name,last_name), assigner:employees!tasks_assigned_by_fkey(first_name,last_name)";

const REPORT_SELECT =
  "id, employee_id, report_date, status, submitted_at, total_hours, blockers, plan_for_tomorrow, summary_html, review_status, lead_rating, lead_remarks, reviewed_by, reviewed_at, escalated, reopen_reason, waiver_reason, employees!daily_work_reports_employee_id_fkey(first_name,last_name), dwr_items(id, task_id, description, description_html, hours, item_status, is_unplanned)";

export const workService = {
  async listProjects(): Promise<Project[]> {
    const db = database();
    const { data, error } = await db
      .from("projects")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return (data ?? []).map(mapProject);
  },

  async createProject(name: string): Promise<Project> {
    const db = database();
    const organizationId = await requireOrganizationId();
    const { data, error } = await db
      .from("projects")
      .insert({ organization_id: organizationId, name: name.trim(), is_active: true })
      .select("id, name, is_active")
      .single();
    if (error) throw error;
    return mapProject(data);
  },

  async listTasks(): Promise<WorkTask[]> {
    const db = database();
    const { data, error } = await db
      .from("tasks")
      .select(TASK_SELECT)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapTask);
  },

  async assignTask(input: AssignTaskInput): Promise<void> {
    const db = database();
    const [organizationId, assignedBy] = await Promise.all([
      requireOrganizationId(),
      requireEmployeeId(),
    ]);
    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      assigned_by: assignedBy,
      assigned_to: input.assignedTo,
      title: input.title.trim(),
      description: input.description.trim(),
      priority: input.priority,
      due_date: input.dueDate || null,
      estimated_hours: input.estimatedHours,
      status: "todo",
    };
    if (input.projectId) payload["project_id"] = input.projectId;
    const { error } = await db.from("tasks").insert(payload);
    if (error) throw error;
  },

  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const db = database();
    const { error } = await db.from("tasks").update({ status }).eq("id", taskId);
    if (error) throw error;
  },

  async listComments(taskId: string): Promise<TaskComment[]> {
    const db = database();
    const { data, error } = await db
      .from("task_comments")
      .select(
        "id, task_id, author_id, body, created_at, author:employees!task_comments_author_id_fkey(first_name,last_name)",
      )
      .eq("task_id", taskId)
      .order("created_at");
    if (error) throw error;
    return (data ?? []).map(mapComment);
  },

  async addComment(taskId: string, body: string): Promise<void> {
    const db = database();
    const authorId = await requireEmployeeId();
    const { error } = await db.from("task_comments").insert({
      task_id: taskId,
      author_id: authorId,
      body: body.trim(),
    });
    if (error) throw error;
  },

  async listDirectory(): Promise<DirectoryEmployee[]> {
    const db = database();
    const { data, error } = await db
      .from("employees")
      .select("id, first_name, last_name, department_id")
      .order("first_name");
    if (error) throw error;
    return ((data ?? []) as LooseRow[]).map((row) => ({
      id: row.id ?? "",
      name: personName(row) || "Employee",
      departmentId: row.department_id ?? null,
    }));
  },

  async listDepartments(): Promise<{ id: string; name: string }[]> {
    const db = database();
    const { data, error } = await db.from("departments").select("id, name").order("name");
    if (error) throw error;
    return ((data ?? []) as LooseRow[]).map((row) => ({
      id: row.id ?? "",
      name: row.name ?? "Department",
    }));
  },

  async myContext(): Promise<MyWorkContext> {
    const db = database();
    const employeeId = await requireEmployeeId();
    const { data, error } = await db
      .from("employees")
      .select("department_id, organization_id, shift_id")
      .eq("id", employeeId)
      .maybeSingle();
    if (error) throw error;

    let shift = { ...DEFAULT_SHIFT };
    if (data?.shift_id) {
      const shiftRow = await db
        .from("shifts")
        .select("start_time, end_time, is_overnight")
        .eq("id", data.shift_id)
        .maybeSingle();
      if (shiftRow.error) throw shiftRow.error;
      if (shiftRow.data) {
        shift = {
          startTime: String(shiftRow.data.start_time ?? DEFAULT_SHIFT.startTime).slice(0, 8),
          endTime: String(shiftRow.data.end_time ?? DEFAULT_SHIFT.endTime).slice(0, 8),
          isOvernight: Boolean(shiftRow.data.is_overnight),
        };
      }
    }

    return {
      employeeId,
      departmentId: data?.department_id ?? null,
      organizationId: data?.organization_id ?? null,
      shift,
    };
  },

  async listReports(): Promise<DailyWorkReport[]> {
    const db = database();
    const { data, error } = await db
      .from("daily_work_reports")
      .select(REPORT_SELECT)
      .order("report_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapReport);
  },

  async saveDraft(input: SaveReportInput): Promise<string> {
    const db = database();
    const { data, error } = await db.rpc("save_dwr_draft_v2", {
      p_report_date: input.reportDate,
      p_blockers: input.blockers,
      p_plan_for_tomorrow: input.planForTomorrow,
      p_items: itemPayload(input.items),
      p_summary_html: input.summaryHtml,
    });
    if (error) throw error;
    return String(data);
  },

  async submitReport(input: SaveReportInput): Promise<{ id: string; status: DwrStatus }> {
    const db = database();
    const { data, error } = await db.rpc("submit_dwr_v2", {
      p_report_date: input.reportDate,
      p_blockers: input.blockers,
      p_plan_for_tomorrow: input.planForTomorrow,
      p_items: itemPayload(input.items),
      p_summary_html: input.summaryHtml,
    });
    if (error) throw error;
    const body = (data ?? {}) as { id?: string; status?: DwrStatus };
    return { id: String(body.id ?? ""), status: body.status ?? "submitted" };
  },

  async reviewReport(
    reportId: string,
    decision: "approved" | "needs-revision",
    rating: number | null,
    remarks: string,
  ): Promise<void> {
    const db = database();
    const { error } = await db.rpc("review_dwr", {
      p_report_id: reportId,
      p_decision: decision,
      p_rating: rating,
      p_remarks: remarks,
    });
    if (error) throw error;
  },

  async reopenReport(reportId: string, reason: string): Promise<void> {
    const db = database();
    const { error } = await db.rpc("reopen_dwr", { p_report_id: reportId, p_reason: reason });
    if (error) throw error;
  },

  async waiveMissed(reportId: string, reason: string): Promise<void> {
    const db = database();
    const { error } = await db.rpc("waive_missed_dwr", { p_report_id: reportId, p_reason: reason });
    if (error) throw error;
  },

  async listSummaries(): Promise<TeamDailySummary[]> {
    const db = database();
    const { data, error } = await db
      .from("team_daily_summaries")
      .select(
        "id, lead_employee_id, department_id, report_date, summary, highlights, risks, lead:employees!team_daily_summaries_lead_employee_id_fkey(first_name,last_name), departments(name)",
      )
      .order("report_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapSummary);
  },

  async saveSummary(input: SaveSummaryInput): Promise<string> {
    const db = database();
    const { data, error } = await db.rpc("save_team_daily_summary", {
      p_report_date: input.reportDate,
      p_department_id: input.departmentId,
      p_summary: input.summary,
      p_highlights: input.highlights,
      p_risks: input.risks,
    });
    if (error) throw error;
    return String(data);
  },

  async checkoutAllowed(employeeId: string, date: string): Promise<CheckoutAllowed> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { allowed: false, reason: CHECKOUT_MISSING_REASON };
    }
    if (!isSupabaseConfigured || !supabase) return { allowed: true };
    const db = database();
    const { data, error } = await db.rpc("checkout_allowed", {
      p_employee_id: employeeId,
      p_date: date,
    });
    if (error) throw error;
    const body = (data ?? {}) as { allowed?: boolean; reason?: string | null };
    if (body.allowed) return { allowed: true };
    const reason =
      typeof body.reason === "string" && body.reason.trim() ? body.reason : CHECKOUT_MISSING_REASON;
    return { allowed: false, reason };
  },
};
