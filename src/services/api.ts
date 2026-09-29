import { isSupabaseConfigured } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";

/**
 * Single seam between the UI and the data source.
 *
 * Today every service resolves demo fixtures through `fromFixture`. Once the
 * Supabase schema exists, each service function swaps its body for a real
 * query (`supabase.from("employees").select()`) and returns the same typed
 * shape — no UI change required.
 */

export const DATA_SOURCE: "supabase" | "fixtures" = isSupabaseConfigured ? "supabase" : "fixtures";

const LATENCY_MS = 180;

export function fromFixture<T>(data: T, latency = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(data), latency);
  });
}

export type QueryOptions = {
  search?: string;
  status?: string;
  department?: string;
  from?: string;
  to?: string;
  employeeId?: string;
};

export function matchesSearch(haystack: (string | null | undefined)[], search?: string) {
  if (!search) return true;
  const q = search.trim().toLowerCase();
  return haystack.some((value) => (value ?? "").toLowerCase().includes(q));
}

export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function currentOrganizationId(): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId || !supabase) return null;
  const profile = await supabase
    .from("profiles")
    .select("employee_id")
    .eq("id", userId)
    .maybeSingle();
  const employeeId = (profile.data as { employee_id?: string | null } | null)?.employee_id;
  if (employeeId) {
    const linked = await supabase
      .from("employees")
      .select("organization_id")
      .eq("id", employeeId)
      .maybeSingle();
    if (!linked.error && linked.data?.organization_id) return linked.data.organization_id;
  }
  const linked = await supabase
    .from("employees")
    .select("organization_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (!linked.error && linked.data?.organization_id) return linked.data.organization_id;
  return null;
}

export async function currentEmployeeId(fallbackId?: string): Promise<string | null> {
  if (!supabase) return fallbackId ?? null;
  const userId = await currentUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("employees")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();
    if (error && !/profile_id|user_id/.test(error.message)) throw error;
    if (data?.id) return data.id as string;
  }
  return fallbackId ?? null;
}

export async function requireOrganizationId(): Promise<string> {
  const organizationId = await currentOrganizationId();
  if (!organizationId) {
    throw new Error("Your profile is not linked to an organization yet. Contact an administrator.");
  }
  return organizationId;
}

export async function requireEmployeeId(fallbackId?: string): Promise<string> {
  const employeeId = await currentEmployeeId(fallbackId);
  if (!employeeId) {
    throw new Error(
      "Your account is not linked to an employee record yet. Contact an administrator.",
    );
  }
  return employeeId;
}

export function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.");
  }
  return supabase;
}

// Best-effort audit trail write via the log_audit_event RPC (audit_logs has
// no direct INSERT policy -- organization_id/user_id are resolved
// server-side from the caller's own session, never trusted from the
// client). Never throws: a failed audit write must not block the real
// mutation it's describing.
export async function logAudit(
  action: string,
  entityType: string,
  entityId?: string | null,
  oldData?: Record<string, unknown> | null,
  newData?: Record<string, unknown> | null,
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    await supabase.rpc("log_audit_event", {
      p_action: action,
      p_entity_type: entityType,
      ...(entityId ? { p_entity_id: entityId } : {}),
      ...(oldData ? { p_old_data: oldData as never } : {}),
      ...(newData ? { p_new_data: newData as never } : {}),
    });
  } catch {
    // Best-effort only.
  }
}
