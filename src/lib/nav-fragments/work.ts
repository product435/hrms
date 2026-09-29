import { ListChecks } from "lucide-react";
import { ALL_ROLES } from "@/lib/roles";
import type { NavItem } from "@/lib/navigation";

/** Coordinator splices this into the sidebar. Roles are admin, hr, dept_head, team_lead, employee. */
export const workNavItem: NavItem = {
  label: "Work",
  to: "/work",
  icon: ListChecks,
  roles: ALL_ROLES,
};
