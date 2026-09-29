import type { Role } from "@/types";

export interface OnboardingNavItem {
  label: string;
  to: string;
  roles: Role[];
}

/** Sidebar items for the coordinator to merge. complete-profile is not a sidebar link. */
export const onboardingNavItems: OnboardingNavItem[] = [
  { label: "Onboarding", to: "/onboarding", roles: ["admin", "hr"] },
];

/**
 * Merge into authService ROUTE_ROLES.
 * Employment status, not this map, limits pending and rejected accounts.
 * profile-status stays reachable after activation so employees can request changes.
 */
export const onboardingRouteRoles: Record<string, Role[]> = {
  "/onboarding": ["admin", "hr"],
  "/complete-profile": ["admin", "hr", "dept_head", "team_lead", "employee"],
  "/profile-status": ["admin", "hr", "dept_head", "team_lead", "employee"],
};
