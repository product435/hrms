import { useSession } from "@/hooks/useSession";
import { isLeadRole } from "@/lib/roles";
import type { CrmAccess } from "@/types";

const NO_CRM_ACCESS: CrmAccess = {
  hasAccess: false,
  canWrite: false,
  canManageAll: false,
  isSalesMember: false,
};

export function usePermissions() {
  const session = useSession();
  const { role } = session;
  const isSuperAdmin = role === "admin";
  const isGeneralManager = role === "general_manager";
  const isHr = role === "hr";
  const isDeptHead = role === "dept_head";
  const isTeamLead = role === "team_lead";
  const isLead = isLeadRole(role);
  const isEmployee = role === "employee";

  return {
    ...session,
    isSuperAdmin,
    isGeneralManager,
    isHr,
    isDeptHead,
    isTeamLead,
    isLead,
    isEmployee,
    canManageTeam: isSuperAdmin || isHr || isLead,
    canDecideApprovals: isSuperAdmin || isHr || isLead,
    crm: session.user.crm ?? NO_CRM_ACCESS,
  };
}
