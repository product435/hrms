import type { NotificationItem } from "@/types";

export interface NotificationTarget {
  href: string;
  label: string;
}

function employeeHref(employeeId: string, tab?: string) {
  const search = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  return `/employees/${encodeURIComponent(employeeId)}${search}`;
}

export function notificationTarget(item: NotificationItem): NotificationTarget | null {
  const referenceType = item.referenceType ?? "";
  const referenceId = item.referenceId ?? "";

  switch (referenceType) {
    case "employee_complaint":
      return referenceId
        ? { href: employeeHref(referenceId, "complaints"), label: "Open complaint" }
        : null;
    case "employees":
      return referenceId ? { href: employeeHref(referenceId), label: "Open employee" } : null;
    case "project_message":
      return item.targetProjectId
        ? { href: `/projects/${encodeURIComponent(item.targetProjectId)}`, label: "Open project" }
        : { href: "/projects", label: "Open projects" };
    case "announcement":
      return { href: "/announcements", label: "Open announcements" };
    case "password_reset_request":
      return { href: "/", label: "Open dashboard" };
    case "kra_manual_missing":
      return { href: "/kra", label: "Open KRA" };
    case "dwr_window_open":
    case "dwr_ten_minutes":
    case "dwr_pending_review":
    case "dwr_escalated":
      return { href: "/work", label: "Open work" };
    default:
      return null;
  }
}
