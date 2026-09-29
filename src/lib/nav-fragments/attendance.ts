import { ALL_ROLES } from "@/lib/roles";
import type { Role } from "@/types";

/** Every role can open attendance. The coordinator merges this into navigation. */
export const ATTENDANCE_ROUTE_ROLES: Role[] = ALL_ROLES;
