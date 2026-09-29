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
  ShieldCheck,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { ATTENDANCE_ROUTE_ROLES } from "@/lib/nav-fragments/attendance";
import { kraEmployeeLabelOverrides, kraNavItem } from "@/lib/nav-fragments/kra";
import { workNavItem } from "@/lib/nav-fragments/work";
import { ALL_ROLES, STAFF_ROLES } from "@/lib/roles";
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

const ALL: Role[] = ALL_ROLES;

export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", to: "/", icon: Gauge, roles: ALL },
      { label: "Announcements", to: "/announcements", icon: Megaphone, roles: ALL },
      { label: "Notifications", to: "/notifications", icon: Bell, roles: ALL },
    ],
  },
  {
    title: "People",
    items: [
      {
        label: "Employees",
        to: "/employees",
        icon: Users,
        roles: STAFF_ROLES,
      },
      {
        label: "Departments",
        to: "/departments",
        icon: Building2,
        roles: ["admin", "dept_head"],
      },
      {
        label: "Designations",
        to: "/designations",
        icon: BriefcaseBusiness,
        roles: ["admin"],
      },
      { label: "Onboarding", to: "/onboarding", icon: UserPlus, roles: ["admin", "hr"] },
      { label: "Recruitment", to: "/recruitment", icon: Briefcase, roles: ["admin", "hr"] },
    ],
  },
  {
    title: "Time & Attendance",
    items: [
      {
        label: "Attendance",
        to: "/attendance",
        icon: CalendarCheck,
        roles: ATTENDANCE_ROUTE_ROLES,
      },
      workNavItem,
      { label: "Shifts", to: "/shifts", icon: CalendarClock, roles: STAFF_ROLES },
      { label: "Leave", to: "/leave", icon: ClipboardList, roles: ALL },
    ],
  },
  {
    title: "Compensation",
    items: [
      {
        label: "Payroll",
        to: "/payroll",
        icon: BadgeIndianRupee,
        roles: ["admin", "hr", "employee"],
      },
      { label: "Expenses", to: "/expenses", icon: Receipt, roles: ALL },
    ],
  },
  {
    title: "Growth",
    items: [
      { label: "Goals", to: "/goals", icon: Target, roles: ALL },
      { label: "Performance", to: "/performance", icon: ChartBar, roles: ALL },
      kraNavItem,
    ],
  },
  {
    title: "Workplace",
    items: [
      { label: "Assets", to: "/assets", icon: LaptopMinimal, roles: ALL },
      { label: "Documents", to: "/documents", icon: FileText, roles: ALL },
      { label: "HR Helpdesk", to: "/helpdesk", icon: LifeBuoy, roles: ALL },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Role management", to: "/roles", icon: ShieldCheck, roles: ["admin"] },
      { label: "Reports & Analytics", to: "/reports", icon: ChartBar, roles: STAFF_ROLES },
      { label: "Activity History", to: "/audit", icon: Activity, roles: ["admin", "hr"] },
      { label: "Settings", to: "/settings", icon: Settings, roles: STAFF_ROLES },
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
  "/performance": "My Performance",
  "/expenses": "My Expenses",
  "/helpdesk": "My Requests",
  ...kraEmployeeLabelOverrides,
};

export const leadLabelOverrides: Record<string, string> = {
  "/employees": "My Team",
  "/leave": "Leave approvals",
  "/documents": "Team Documents",
};

export const deptHeadLabelOverrides: Record<string, string> = {
  ...leadLabelOverrides,
  "/employees": "My Department",
  "/documents": "Department Documents",
};
