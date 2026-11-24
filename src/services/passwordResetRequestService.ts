/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joins are not in the generated row types. */
import { isStrongPassword } from "@/lib/password";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { PasswordResetRequest } from "@/types";
import { authService, passwordRecoveryRedirect } from "./authService";
import { currentUserId } from "./api";

function surfacedResetError(message: string): boolean {
  return /rate limit|too many attempts|network error|failed to fetch|timeout/i.test(message);
}

function mapRequest(r: any): PasswordResetRequest {
  return {
    id: r.id,
    employeeId: r.employee_id ?? null,
    employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
    email: r.email,
    status: r.status,
    requestedAt: r.requested_at,
    approvedByName: r.approved_by_profile?.full_name ?? "",
    approvedAt: r.approved_at ?? null,
    rejectedReason: r.rejected_reason ?? null,
  };
}

export const passwordResetRequestService = {
  // One response for every address. Auth recover runs first so an admin still
  // receives a reset email; the RPC then queues non-admins and clears their
  // fresh recovery token. Callers must not branch on the RPC payload.
  async request(email: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const emailResult = await authService.resetPasswordForEmail(email);
    const { error } = await supabase.rpc("request_password_reset", { p_email: email });
    if (error) throw error;
    if (emailResult.error && surfacedResetError(emailResult.error.message)) {
      throw new Error(emailResult.error.message);
    }
  },
  // Admin-only (enforced by RLS): every pending request across the
  // organization -- there's a single Admin, so no org filter is needed here
  // the way other services need one.
  async listPending(): Promise<PasswordResetRequest[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("password_reset_requests")
      .select("*, employees(first_name,last_name)")
      .eq("status", "PENDING")
      .order("requested_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRequest);
  },
  // Sends the real Supabase recovery email (the same mechanism the direct
  // Forgot Password flow uses) and records who approved it and when.
  async approve(id: string, email: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const redirectTo = passwordRecoveryRedirect();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (resetError) throw resetError;
    const approverId = await currentUserId();
    const { error } = await supabase
      .from("password_reset_requests")
      .update({
        status: "APPROVED",
        ...(approverId ? { approved_by: approverId } : {}),
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },
  async reject(id: string, reason: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const approverId = await currentUserId();
    const { error } = await supabase
      .from("password_reset_requests")
      .update({
        status: "REJECTED",
        rejected_reason: reason.trim() || null,
        ...(approverId ? { approved_by: approverId } : {}),
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },
  // Super Admin only. Routed through the admin-set-employee-password Edge
  // Function (not the admin_set_employee_password RPC directly) because
  // that function also creates the employee's Supabase Auth account first
  // when one doesn't exist yet -- e.g. an employee added via "Add
  // employee" who has never signed up. For an employee who already has an
  // account, behavior is unchanged: the Edge Function still ends by
  // calling the same RPC, which hashes the password, revokes sessions, and
  // never returns the password.
  async setEmployeePassword(employeeId: string, password: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    if (!employeeId) throw new Error("Choose an employee.");
    if (!isStrongPassword(password) || password.length > 72) {
      throw new Error("Password does not meet the requirements.");
    }
    const { data, error } = await supabase.functions.invoke("admin-set-employee-password", {
      body: { employee_id: employeeId, password },
    });
    if (error) {
      const context = (error as { context?: unknown }).context;
      if (context instanceof Response) {
        try {
          const body = (await context.clone().json()) as { error?: string };
          if (body?.error) throw new Error(body.error);
        } catch {
          /* fall through to the generic error below */
        }
      }
      throw error;
    }
    if (data?.error) throw new Error(String(data.error));
  },
  // Called from the authenticated recovery session right after a
  // successful password update, so the request's lifecycle actually
  // reflects that the user finished the flow.
  async markCompleted(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    await supabase.rpc("complete_password_reset_request");
  },
};
