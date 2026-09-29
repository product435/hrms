/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joins are not in the generated row types. */
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
  // Called from the authenticated recovery session right after a
  // successful password update, so the request's lifecycle actually
  // reflects that the user finished the flow.
  async markCompleted(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    await supabase.rpc("complete_password_reset_request");
  },
};
