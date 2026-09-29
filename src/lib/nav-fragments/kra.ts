import type { LucideIcon } from "lucide-react";
import { LineChart } from "lucide-react";
import type { Role } from "@/types";

/** Sidebar entry for Growth. Merge into navSections; do not import navigation.ts (cycle). */
export const kraNavSection = "Growth";

export const kraNavItem: {
  label: string;
  to: "/kra";
  icon: LucideIcon;
  roles: Role[];
} = {
  label: "KRA & KPI",
  to: "/kra",
  icon: LineChart,
  roles: ["admin", "hr", "dept_head", "team_lead", "employee"],
};

/** Employee-facing label. Leads and HR keep "KRA & KPI". */
export const kraEmployeeLabelOverrides: Record<string, string> = {
  "/kra": "My KRA & KPI",
};
