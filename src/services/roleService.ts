import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { normalizeRole } from "@/lib/roles";
import type { Role } from "@/types";

type LooseRow = Record<string, unknown>;

const rpcClient = () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase as unknown as {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{
      data: unknown;
      error: { message?: string } | null;
    }>;
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          order: (
            column: string,
            options?: { ascending?: boolean },
          ) => {
            limit: (
              count: number,
            ) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
          neq: (
            column: string,
            value: string,
          ) => {
            order: (
              column: string,
              options?: { ascending?: boolean },
            ) => {
              limit: (
                count: number,
              ) => Promise<{ data: unknown; error: { message?: string } | null }>;
            };
          };
        };
      };
    };
  };
};

function fail(error: { message?: string } | null) {
  if (error) throw new Error(error.message || "Request failed.");
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function relation(value: unknown): LooseRow | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as LooseRow) : null;
  }
  return value as LooseRow;
}

function field(row: LooseRow, key: string) {
  return row[key];
}

function personName(value: unknown) {
  const row = relation(value);
  if (!row) return "";
  return `${text(field(row, "first_name"))} ${text(field(row, "last_name"))}`.trim();
}

export interface RoleDirectoryEmployee {
  id: string;
  name: string;
  code: string;
  email: string;
  role: Role;
  departmentId: string | null;
  departmentName: string;
  managerId: string | null;
  managerName: string;
}

export interface RoleDirectoryDepartment {
  id: string;
  name: string;
  managerId: string | null;
  managerName: string;
}

export interface OrgMetricRow {
  departmentId: string | null;
  departmentName: string;
  headcount: number;
  performanceIndex: number | null;
  attendancePercent: number | null;
  dwrCompliance: number | null;
  taskCompletion: number | null;
}

export interface OrgEmployeeMetric {
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string;
  performanceIndex: number | null;
  attendancePercent: number | null;
  dwrCompliance: number | null;
  taskCompletion: number | null;
}

export interface OrgPerformanceBoard {
  departments: OrgMetricRow[];
  employees: OrgEmployeeMetric[];
  top: OrgEmployeeMetric[];
  bottom: OrgEmployeeMetric[];
}

export interface EmployeeWorkSnapshot {
  reports: Array<{
    id: string;
    date: string;
    status: string;
    hours: number | null;
    reviewStatus: string;
    rating: number | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
  }>;
}

const EMPTY_BOARD: OrgPerformanceBoard = { departments: [], employees: [], top: [], bottom: [] };

function mapDepartmentMetric(row: LooseRow): OrgMetricRow {
  return {
    departmentId: text(field(row, "department_id")) || null,
    departmentName: text(field(row, "department_name"), "Unassigned"),
    headcount: num(field(row, "headcount")) ?? 0,
    performanceIndex: num(field(row, "performance_index")),
    attendancePercent: num(field(row, "attendance_percent")),
    dwrCompliance: num(field(row, "dwr_compliance")),
    taskCompletion: num(field(row, "task_completion")),
  };
}

function mapEmployeeMetric(row: LooseRow): OrgEmployeeMetric {
  return {
    employeeId: text(field(row, "employee_id")),
    employeeName: text(field(row, "employee_name"), "Employee"),
    departmentId: text(field(row, "department_id")) || null,
    departmentName: text(field(row, "department_name"), "Unassigned"),
    performanceIndex: num(field(row, "performance_index")),
    attendancePercent: num(field(row, "attendance_percent")),
    dwrCompliance: num(field(row, "dwr_compliance")),
    taskCompletion: num(field(row, "task_completion")),
  };
}

function rowsOf(value: unknown): LooseRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LooseRow => Boolean(item) && typeof item === "object");
}

const ROLE_RANK: Record<Role, number> = {
  admin: 5,
  hr: 4,
  dept_head: 3,
  team_lead: 2,
  employee: 1,
};

export function isRoleDemotion(from: Role, to: Role) {
  return ROLE_RANK[to] < ROLE_RANK[from];
}

export const roleService = {
  async directory(): Promise<{
    employees: RoleDirectoryEmployee[];
    departments: RoleDirectoryDepartment[];
  }> {
    if (!isSupabaseConfigured || !supabase) return { employees: [], departments: [] };
    const [employees, departments] = await Promise.all([
      supabase
        .from("employees")
        .select(
          "id, employee_code, first_name, last_name, email, department_id, manager_id, departments!employees_department_id_fkey(name), manager:manager_id(first_name, last_name), profiles!employees_profile_fk(role)",
        )
        .order("first_name"),
      supabase
        .from("departments")
        .select("id, name, manager_id, manager:manager_id(first_name, last_name)")
        .order("name"),
    ]);
    if (employees.error) throw employees.error;
    if (departments.error) throw departments.error;

    return {
      employees: (employees.data ?? []).map((row) => {
        const record = row as LooseRow;
        const profile = relation(field(record, "profiles"));
        const department = relation(field(record, "departments"));
        return {
          id: text(field(record, "id")),
          name:
            `${text(field(record, "first_name"))} ${text(field(record, "last_name"))}`.trim() ||
            "Employee",
          code: text(field(record, "employee_code")),
          email: text(field(record, "email")),
          role: normalizeRole(profile ? field(profile, "role") : null) ?? "employee",
          departmentId: text(field(record, "department_id")) || null,
          departmentName: text(department ? field(department, "name") : null, "Unassigned"),
          managerId: text(field(record, "manager_id")) || null,
          managerName: personName(field(record, "manager")) || "No lead",
        };
      }),
      departments: (departments.data ?? []).map((row) => {
        const record = row as LooseRow;
        return {
          id: text(field(record, "id")),
          name: text(field(record, "name"), "Department"),
          managerId: text(field(record, "manager_id")) || null,
          managerName: personName(field(record, "manager")),
        };
      }),
    };
  },

  async setRole(employeeId: string, role: Role) {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.rpc("set_employee_role", {
      p_employee_id: employeeId,
      p_role: role,
    });
    fail(error);
  },

  async setPlacement(employeeId: string, departmentId: string | null, managerId: string | null) {
    const { error } = await rpcClient().rpc("set_employee_placement", {
      p_employee_id: employeeId,
      p_department_id: departmentId,
      p_manager_id: managerId,
    });
    fail(error);
  },

  async setDepartmentHead(departmentId: string, managerId: string | null) {
    const { error } = await rpcClient().rpc("set_department_head", {
      p_department_id: departmentId,
      p_manager_id: managerId,
    });
    fail(error);
  },

  async performanceBoard(period: string): Promise<OrgPerformanceBoard> {
    if (!isSupabaseConfigured || !supabase) return EMPTY_BOARD;
    const { data, error } = await rpcClient().rpc("org_performance_board", { period });
    fail(error);
    const board = data && typeof data === "object" ? (data as LooseRow) : {};
    return {
      departments: rowsOf(field(board, "departments")).map(mapDepartmentMetric),
      employees: rowsOf(field(board, "employees")).map(mapEmployeeMetric),
      top: rowsOf(field(board, "top")).map(mapEmployeeMetric),
      bottom: rowsOf(field(board, "bottom")).map(mapEmployeeMetric),
    };
  },

  async employeeWork(employeeId: string): Promise<EmployeeWorkSnapshot> {
    if (!isSupabaseConfigured || !supabase) return { reports: [], tasks: [] };
    const db = rpcClient();
    const [reports, tasks] = await Promise.all([
      db
        .from("daily_work_reports")
        .select("id, report_date, status, total_hours, review_status, lead_rating")
        .eq("employee_id", employeeId)
        .order("report_date", { ascending: false })
        .limit(8),
      db
        .from("tasks")
        .select("id, title, status, priority, due_date")
        .eq("assigned_to", employeeId)
        .neq("status", "done")
        .order("due_date", { ascending: true })
        .limit(12),
    ]);
    fail(reports.error);
    fail(tasks.error);
    return {
      reports: rowsOf(reports.data).map((row) => ({
        id: text(field(row, "id")),
        date: text(field(row, "report_date")),
        status: text(field(row, "status"), "draft"),
        hours: num(field(row, "total_hours")),
        reviewStatus: text(field(row, "review_status"), "pending"),
        rating: num(field(row, "lead_rating")),
      })),
      tasks: rowsOf(tasks.data).map((row) => ({
        id: text(field(row, "id")),
        title: text(field(row, "title"), "Task"),
        status: text(field(row, "status"), "todo"),
        priority: text(field(row, "priority"), "medium"),
        dueDate: text(field(row, "due_date")) || null,
      })),
    };
  },
};
