import { useSession } from "@/hooks/useSession";
import { isLeadRole } from "@/lib/roles";

export function usePermissions() {
  const session = useSession();
  const { role } = session;
  const isSuperAdmin = role === "admin";
  const isHr = role === "hr";
  const isDeptHead = role === "dept_head";
  const isTeamLead = role === "team_lead";
  const isLead = isLeadRole(role);
  const isEmployee = role === "employee";

  return {
    ...session,
    isSuperAdmin,
    isHr,
    isDeptHead,
    isTeamLead,
    isLead,
    isEmployee,
    canManageTeam: isSuperAdmin || isHr || isLead,
    canDecideApprovals: isSuperAdmin || isHr || isLead,
  };
}
