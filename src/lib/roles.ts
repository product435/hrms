import type { Role } from "@/types";

export const ALL_ROLES: Role[] = [
  "admin",
  "general_manager",
  "hr",
  "dept_head",
  "team_lead",
  "employee",
];

/** Former manager routes: super admin, general manager, HR, department head, and team lead. */
export const STAFF_ROLES: Role[] = ["admin", "general_manager", "hr", "dept_head", "team_lead"];

export const LEAD_ROLES: Role[] = ["dept_head", "team_lead"];

/** Roles that read work reports and KPIs across the whole organisation. */
export const ORG_OVERVIEW_ROLES: Role[] = ["admin", "general_manager", "hr"];

export function normalizeRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "manager") return "team_lead";
  if (
    normalized === "admin" ||
    normalized === "general_manager" ||
    normalized === "hr" ||
    normalized === "dept_head" ||
    normalized === "team_lead" ||
    normalized === "employee"
  ) {
    return normalized;
  }
  return null;
}

export function isLeadRole(role: Role): boolean {
  return role === "dept_head" || role === "team_lead";
}
