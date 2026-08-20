import {
  Activity,
  BadgeIndianRupee,
  Bell,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChartBar,
  ClipboardList,
  FileText,
  Gauge,
  LaptopMinimal,
  LifeBuoy,
  Megaphone,
  Receipt,
  Settings,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import type { Role } from "@/types";

export interface NavItem {
  label: string;
  to: string;
  icon: typeof Users;
  roles: Role[];
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const ALL: Role[] = ["admin", "hr", "manager", "employee"];

export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", to: "/", icon: Gauge, roles: ALL },
      { label: "Announcements", to: "/announcements", icon: Megaphone, roles: [] },
      { label: "Notifications", to: "/notifications", icon: Bell, roles: [] },
    ],
  },
  {
    title: "People",
    items: [
      {
        label: "Employees",
        to: "/employees",
        icon: Users,
        roles: ["admin", "hr", "manager"],
      },
      {
        label: "Departments",
        to: "/departments",
        icon: Building2,
        roles: ["admin"],
      },
      {
        label: "Designations",
        to: "/designations",
        icon: BriefcaseBusiness,
        roles: ["admin"],
      },
      { label: "Onboarding", to: "/onboarding", icon: UserPlus, roles: [] },
      { label: "Recruitment", to: "/recruitment", icon: Briefcase, roles: ["admin", "hr"] },
    ],
  },
  {
    title: "Time & Attendance",
    items: [
      { label: "Attendance", to: "/attendance", icon: CalendarCheck, roles: ALL },
      { label: "Shifts", to: "/shifts", icon: CalendarClock, roles: [] },
      { label: "Leave", to: "/leave", icon: ClipboardList, roles: ALL },
    ],
  },
  {
    title: "Compensation",
    items: [
      { label: "Payroll", to: "/payroll", icon: BadgeIndianRupee, roles: ["admin", "hr", "employee"] },
      { label: "Expenses", to: "/expenses", icon: Receipt, roles: [] },
    ],
  },
  {
    title: "Growth",
    items: [
      { label: "Goals", to: "/goals", icon: Target, roles: ["manager", "employee"] },
      { label: "Performance", to: "/performance", icon: ChartBar, roles: ["admin", "manager"] },
    ],
  },
  {
    title: "Workplace",
    items: [
      { label: "Assets", to: "/assets", icon: LaptopMinimal, roles: ["admin", "employee"] },
      { label: "Documents", to: "/documents", icon: FileText, roles: ["hr", "employee"] },
      { label: "HR Helpdesk", to: "/helpdesk", icon: LifeBuoy, roles: [] },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Reports & Analytics", to: "/reports", icon: ChartBar, roles: ["admin", "hr"] },
      { label: "Activity History", to: "/audit", icon: Activity, roles: [] },
      { label: "Settings", to: "/settings", icon: Settings, roles: ["admin"] },
    ],
  },
];

export function navForRole(role: Role): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Employee-facing labels: the same routes read differently for self-service. */
export const employeeLabelOverrides: Record<string, string> = {
  "/attendance": "My Attendance",
  "/leave": "My Leave",
  "/payroll": "My Payroll",
  "/assets": "My Assets",
  "/documents": "My Documents",
  "/goals": "My Goals",
  "/expenses": "My Expenses",
  "/helpdesk": "My Requests",
};

export const managerLabelOverrides: Record<string, string> = {
  "/employees": "My Team",
  "/leave": "Leave approvals",
};
