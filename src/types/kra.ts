import { indiaDateKey } from "@/lib/format";

export type KpiDirection = "higher" | "lower";
export type KpiSource = "manual" | "attendance" | "dwr" | "tasks" | "lead_rating";

export type PerformanceBand =
  "Outstanding" | "Exceeds" | "Meets" | "Needs Improvement" | "Not rated";

/** Outstanding at 90, Exceeds at 75, Meets at 60, Needs Improvement below 60. */
export const BAND_OUTSTANDING = 90;
export const BAND_EXCEEDS = 75;
export const BAND_MEETS = 60;

export function performanceBand(score: number | null | undefined): PerformanceBand {
  if (score == null || Number.isNaN(score)) return "Not rated";
  if (score >= BAND_OUTSTANDING) return "Outstanding";
  if (score >= BAND_EXCEEDS) return "Exceeds";
  if (score >= BAND_MEETS) return "Meets";
  return "Needs Improvement";
}

export function currentKraPeriod(date = new Date()) {
  return indiaDateKey(date).slice(0, 7);
}

export function isKraPeriod(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export interface KpiDefinition {
  id: string;
  metric: string;
  unit: string;
  target: number | null;
  direction: KpiDirection;
  source: KpiSource;
}

export interface KraTemplate {
  id: string;
  departmentId: string | null;
  designationId: string | null;
  name: string;
  weightage: number;
  kpis: KpiDefinition[];
}

export interface KraTemplateDraft {
  id?: string;
  name: string;
  weightage: number;
  kpis: Array<{
    id?: string;
    metric: string;
    unit: string;
    target: number | null;
    direction: KpiDirection;
    source: KpiSource;
  }>;
}

export interface KraAssignment {
  id: string;
  employeeId: string;
  cycle: string;
  templateIds: string[];
  overrides: Record<string, { target?: number }>;
}

export interface PerformanceIndexRow {
  employeeId: string;
  period: string;
  performanceIndex: number | null;
  band: PerformanceBand;
  prorated: boolean;
  measuredFrom: string | null;
}

export interface PerformanceTrendPoint {
  period: string;
  performanceIndex: number | null;
  band: PerformanceBand;
  prorated: boolean;
}

export interface KraScoreRow {
  employeeId: string;
  employeeName: string;
  kraTemplateId: string;
  kraName: string;
  weightage: number;
  kpiDefinitionId: string;
  metric: string;
  unit: string;
  target: number | null;
  direction: KpiDirection;
  source: KpiSource;
  actual: number | null;
  score: number | null;
  prorated: boolean;
  measuredFrom: string | null;
  performanceIndex: number | null;
  band: PerformanceBand;
}

export interface KraCatalog {
  departments: Array<{ id: string; name: string; managerId: string | null }>;
  designations: Array<{ id: string; name: string }>;
  employees: Array<{
    id: string;
    name: string;
    departmentId: string | null;
    designationId: string | null;
    joiningDate: string | null;
  }>;
}

export const KPI_SOURCE_LABELS: Record<KpiSource, string> = {
  manual: "Manual",
  attendance: "Attendance",
  dwr: "Daily work report",
  tasks: "Tasks",
  lead_rating: "Lead rating",
};

/** Starting point for a designation set. Weights total 100. */
export const STANDARD_KRA_SET: KraTemplateDraft[] = [
  {
    name: "Attendance",
    weightage: 25,
    kpis: [
      { metric: "Attendance %", unit: "%", target: 95, direction: "higher", source: "attendance" },
    ],
  },
  {
    name: "Punctuality",
    weightage: 15,
    kpis: [
      { metric: "Punctuality", unit: "%", target: 95, direction: "higher", source: "attendance" },
    ],
  },
  {
    name: "Work reporting",
    weightage: 20,
    kpis: [
      { metric: "DWR submission rate", unit: "%", target: 100, direction: "higher", source: "dwr" },
      { metric: "DWR on-time rate", unit: "%", target: 100, direction: "higher", source: "dwr" },
    ],
  },
  {
    name: "Reporting quality",
    weightage: 20,
    kpis: [
      { metric: "Lead rating", unit: "1-5", target: 5, direction: "higher", source: "lead_rating" },
    ],
  },
  {
    name: "Task delivery",
    weightage: 20,
    kpis: [
      {
        metric: "Task on-time completion",
        unit: "%",
        target: 90,
        direction: "higher",
        source: "tasks",
      },
    ],
  },
];

export function templateSetKey(departmentId: string | null, designationId: string | null) {
  return `${departmentId ?? ""}::${designationId ?? ""}`;
}

export function formatKraScore(score: number | null | undefined) {
  if (score == null || Number.isNaN(score)) return "Not rated";
  return score.toFixed(1);
}
