import { FolderKanban } from "lucide-react";
import { ALL_ROLES } from "@/lib/roles";
import type { NavItem } from "@/lib/navigation";

/** Coordinator splices this into the sidebar. Visible to every role; RLS scopes the rows. */
export const projectsNavItem: NavItem = {
  label: "Projects",
  to: "/projects",
  icon: FolderKanban,
  roles: ALL_ROLES,
};
