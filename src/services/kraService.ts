import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  performanceBand,
  type KraAssignment,
  type KraCatalog,
  type KraScoreRow,
  type KraTemplate,
  type KraTemplateDraft,
  type KpiDirection,
  type KpiSource,
  type PerformanceBand,
  type PerformanceIndexRow,
  type PerformanceTrendPoint,
} from "@/types/kra";

type KraRow = Record<string, unknown>;

const db = () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  // Tables created in this stream are not in the generated Database types.
  return supabase as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (t: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (fn: string, args?: Record<string, unknown>) => any;
  };
};

function fail(error: { message?: string } | null) {
  if (error) throw new Error(error.message || "Request failed.");
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBand(value: unknown, score: number | null): PerformanceBand {
  if (
    value === "Outstanding" ||
    value === "Exceeds" ||
    value === "Meets" ||
    value === "Needs Improvement" ||
    value === "Not rated"
  ) {
    return value;
  }
  return performanceBand(score);
}

function asDirection(value: unknown): KpiDirection {
  return value === "lower" ? "lower" : "higher";
}

function asSource(value: unknown): KpiSource {
  if (
    value === "attendance" ||
    value === "dwr" ||
    value === "tasks" ||
    value === "lead_rating" ||
    value === "manual"
  ) {
    return value;
  }
  return "manual";
}

function text(row: KraRow, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function textOrNull(row: KraRow, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function rowsOf(value: unknown): KraRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is KraRow => Boolean(item) && typeof item === "object");
}

function mapTemplate(row: KraRow): KraTemplate {
  const kpis = rowsOf(row["kpi_definitions"])
    .sort((a, b) => text(a, "metric").localeCompare(text(b, "metric")))
    .map((kpi) => ({
      id: text(kpi, "id"),
      metric: text(kpi, "metric"),
      unit: text(kpi, "unit"),
      target: num(kpi["target"]),
      direction: asDirection(kpi["direction"]),
      source: asSource(kpi["source"]),
    }));
  return {
    id: text(row, "id"),
    departmentId: textOrNull(row, "department_id"),
    designationId: textOrNull(row, "designation_id"),
    name: text(row, "name"),
    weightage: num(row["weightage"]) ?? 0,
    kpis,
  };
}

function mapIndex(row: KraRow, period: string): PerformanceIndexRow {
  const performanceIndex = num(row["performance_index"]);
  return {
    employeeId: text(row, "employee_id"),
    period,
    performanceIndex,
    band: asBand(row["band"], performanceIndex),
    prorated: Boolean(row["prorated"]),
    measuredFrom: textOrNull(row, "measured_from"),
  };
}

export const kraService = {
  async catalog(): Promise<KraCatalog> {
    if (!isSupabaseConfigured || !supabase) {
      return { departments: [], designations: [], employees: [] };
    }
    const [departments, designations, employees] = await Promise.all([
      supabase.from("departments").select("id,name,manager_id").order("name"),
      supabase.from("designations").select("id,name").order("name"),
      supabase
        .from("employees")
        .select("id,first_name,last_name,department_id,designation_id,joining_date")
        .order("first_name"),
    ]);
    fail(departments.error);
    fail(designations.error);
    fail(employees.error);
    return {
      departments: (departments.data ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? "Department",
        managerId: row.manager_id,
      })),
      designations: (designations.data ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? "Designation",
      })),
      employees: (employees.data ?? []).map((row) => ({
        id: row.id,
        name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Employee",
        departmentId: row.department_id,
        designationId: row.designation_id,
        joiningDate: row.joining_date,
      })),
    };
  },

  async templates(): Promise<KraTemplate[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await db()
      .from("kra_templates")
      .select(
        "id,department_id,designation_id,name,weightage,kpi_definitions(id,metric,unit,target,direction,source)",
      )
      .order("name");
    fail(error);
    return (data ?? []).map(mapTemplate);
  },

  async assignments(cycle: string): Promise<KraAssignment[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await db()
      .from("employee_kra_assignments")
      .select("id,employee_id,cycle,template_ids,overrides")
      .eq("cycle", cycle);
    fail(error);
    return (data ?? []).map((row: KraRow) => {
      const templateIds = row["template_ids"];
      const overrides = row["overrides"];
      return {
        id: text(row, "id"),
        employeeId: text(row, "employee_id"),
        cycle: text(row, "cycle"),
        templateIds: Array.isArray(templateIds)
          ? templateIds.filter((id): id is string => typeof id === "string")
          : [],
        overrides:
          overrides && typeof overrides === "object"
            ? (overrides as KraAssignment["overrides"])
            : {},
      };
    });
  },

  async saveTemplateSet(input: {
    departmentId: string | null;
    designationId: string | null;
    templates: KraTemplateDraft[];
  }) {
    const { error } = await db().rpc("save_kra_template_set", {
      definitions: {
        department_id: input.departmentId,
        designation_id: input.designationId,
        templates: input.templates.map((template) => ({
          id: template.id,
          name: template.name,
          weightage: template.weightage,
          kpis: template.kpis.map((kpi) => ({
            id: kpi.id,
            metric: kpi.metric,
            unit: kpi.unit,
            target: kpi.target,
            direction: kpi.direction,
            source: kpi.source,
          })),
        })),
      },
    });
    fail(error);
  },

  async adjustTargets(
    departmentId: string,
    updates: Array<{ kpiDefinitionId: string; target: number }>,
  ) {
    const { error } = await db().rpc("adjust_department_kpi_targets", {
      department_id: departmentId,
      updates: updates.map((update) => ({
        kpi_definition_id: update.kpiDefinitionId,
        target: update.target,
      })),
    });
    fail(error);
  },

  async assign(input: {
    employeeId: string;
    cycle: string;
    templateIds: string[];
    overrides?: Record<string, unknown>;
  }) {
    const { error } = await db().rpc("assign_employee_kras", {
      employee_id: input.employeeId,
      cycle: input.cycle,
      template_ids: input.templateIds,
      overrides: input.overrides ?? {},
    });
    fail(error);
  },

  async enterManualActual(input: {
    employeeId: string;
    kpiDefinitionId: string;
    period: string;
    actual: number | null;
  }) {
    const { error } = await db().rpc("enter_manual_kpi_actual", {
      employee_id: input.employeeId,
      kpi_definition_id: input.kpiDefinitionId,
      period: input.period,
      actual: input.actual,
    });
    fail(error);
  },

  async compute(period: string) {
    const { data, error } = await db().rpc("compute_kpi_scores", { period });
    fail(error);
    return Number(data ?? 0);
  },

  async listIndexes(period: string): Promise<PerformanceIndexRow[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await db().rpc("list_performance_indexes", { period });
    fail(error);
    return (data ?? []).map((row: KraRow) => mapIndex(row, period));
  },

  async trend(
    employeeId: string,
    throughPeriod: string,
    months = 6,
  ): Promise<PerformanceTrendPoint[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await db().rpc("performance_index_trend", {
      employee_id: employeeId,
      through_period: throughPeriod,
      months,
    });
    fail(error);
    return (data ?? []).map((row: KraRow) => {
      const performanceIndex = num(row["performance_index"]);
      return {
        period: text(row, "period"),
        performanceIndex,
        band: asBand(row["band"], performanceIndex),
        prorated: Boolean(row["prorated"]),
      };
    });
  },

  async scoreGrid(period: string): Promise<KraScoreRow[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await db().rpc("kra_monthly_grid", { period });
    fail(error);
    return (data ?? []).map((row: KraRow) => {
      const score = num(row["score"]);
      const performanceIndex = num(row["performance_index"]);
      return {
        employeeId: text(row, "employee_id"),
        employeeName: text(row, "employee_name", "Employee"),
        kraTemplateId: text(row, "kra_template_id"),
        kraName: text(row, "kra_name"),
        weightage: num(row["weightage"]) ?? 0,
        kpiDefinitionId: text(row, "kpi_definition_id"),
        metric: text(row, "metric"),
        unit: text(row, "unit"),
        target: num(row["target"]),
        direction: asDirection(row["direction"]),
        source: asSource(row["source"]),
        actual: num(row["actual"]),
        score,
        prorated: Boolean(row["prorated"]),
        measuredFrom: textOrNull(row, "measured_from"),
        performanceIndex,
        band: asBand(row["band"], performanceIndex),
      };
    });
  },
};
