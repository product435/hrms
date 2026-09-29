import type { OrgEmployeeMetric, OrgMetricRow } from "@/services/roleService";
import type { HeadcountPoint, TrendPoint } from "@/types";

export interface ReportSnapshot {
  headcount: number;
  attritionRate: number | null;
  openPositions: number;
  payrollNet: number;
}

export interface ReportExportData {
  exportedOn: string;
  period: string;
  departmentName: string | null;
  summary: ReportSnapshot | null;
  attendance: TrendPoint[];
  headcountTrend: HeadcountPoint[];
  departments: Array<{ name: string; value: number }>;
  leaveMix: Array<{ name: string; value: number }>;
  /** Null when that section failed to load. An empty array is a real empty result. */
  performanceDepartments: OrgMetricRow[] | null;
  performanceEmployees: OrgEmployeeMetric[] | null;
}

type Cell = string | number | null | undefined;

function csvCell(value: Cell) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function csvRow(cells: Cell[]) {
  return cells.map(csvCell).join(",");
}

function metricCell(value: number | null) {
  return value == null ? "" : value;
}

function section(title: string, headers: string[], rows: Cell[][]) {
  return [csvRow([title]), csvRow(headers), ...rows.map(csvRow)].join("\n");
}

function byLabel<T extends { label: string }>(rows: T[]) {
  return [...rows].sort((left, right) => left.label.localeCompare(right.label));
}

/** Filename uses the selected performance month, for example reports-2026-09.csv. */
export function reportsFilename(period: string) {
  const label = /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : "current";
  return `reports-${label}.csv`;
}

/**
 * CSV of the rows already on the reports page. Empty sections keep their
 * header and no placeholder zero rows. Payroll is the page's net total only.
 */
export function buildReportsCsv(data: ReportExportData) {
  const snapshotRows: Cell[][] = data.summary
    ? [
        ["Headcount", data.summary.headcount],
        ["Attrition", data.summary.attritionRate == null ? "N/A" : data.summary.attritionRate],
        ["Open positions", data.summary.openPositions],
        ["Payroll net", data.summary.payrollNet],
      ]
    : [];

  const blocks = [
    [
      csvRow(["Exported on", data.exportedOn]),
      csvRow(["Performance period", data.period]),
      csvRow(["Department filter", data.departmentName ?? "All departments"]),
    ].join("\n"),
    section("Snapshot", ["Metric", "Value"], snapshotRows),
    section(
      "Attendance trend",
      ["Date", "Present", "Absent", "Work from home"],
      byLabel(data.attendance).map((row) => [row.label, row.present, row.absent, row.wfh]),
    ),
    section(
      "Joiners and exits",
      ["Month", "Joined", "Exited", "Headcount"],
      byLabel(data.headcountTrend).map((row) => [row.label, row.joined, row.exited, row.headcount]),
    ),
    section(
      "Department headcount",
      ["Department", "People"],
      data.departments.map((row) => [row.name, row.value]),
    ),
    section(
      "Leave mix",
      ["Leave type", "Approved days"],
      data.leaveMix.map((row) => [row.name, row.value]),
    ),
  ];

  if (data.performanceDepartments) {
    blocks.push(
      section(
        "Department performance",
        [
          "Department",
          "People",
          "Index",
          "Attendance percent",
          "DWR compliance percent",
          "Task completion percent",
        ],
        data.performanceDepartments.map((row) => [
          row.departmentName,
          row.headcount,
          metricCell(row.performanceIndex),
          metricCell(row.attendancePercent),
          metricCell(row.dwrCompliance),
          metricCell(row.taskCompletion),
        ]),
      ),
    );
  }

  if (data.performanceEmployees) {
    blocks.push(
      section(
        "Employees",
        [
          "Employee",
          "Department",
          "Index",
          "Attendance percent",
          "DWR compliance percent",
          "Task completion percent",
        ],
        data.performanceEmployees.map((row) => [
          row.employeeName,
          row.departmentName,
          metricCell(row.performanceIndex),
          metricCell(row.attendancePercent),
          metricCell(row.dwrCompliance),
          metricCell(row.taskCompletion),
        ]),
      ),
    );
  }

  return `${blocks.join("\n\n")}\n`;
}

export function downloadReportsCsv(period: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = reportsFilename(period);
  anchor.click();
  URL.revokeObjectURL(url);
}
