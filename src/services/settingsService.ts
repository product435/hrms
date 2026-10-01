import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Json } from "@/types/database";
import { currentUserId, requireOrganizationId } from "./api";

export interface NotificationPreferences {
  leaveApprovals: boolean;
  payrollRuns: boolean;
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  leaveApprovals: true,
  payrollRuns: true,
};

export const settingsService = {
  async organization(): Promise<{ name: string; timezone: string }> {
    if (!isSupabaseConfigured || !supabase) return { name: "", timezone: "" };
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("organizations")
      .select("name, timezone")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) throw error;
    return { name: data?.name ?? "", timezone: data?.timezone ?? "" };
  },
  async updateOrganization(input: { name: string; timezone: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { error } = await supabase
      .from("organizations")
      .update({ name: input.name.trim(), timezone: input.timezone.trim() })
      .eq("id", organizationId);
    if (error) throw error;
  },
  async notificationPreferences(): Promise<NotificationPreferences> {
    if (!isSupabaseConfigured || !supabase) return DEFAULT_NOTIFICATION_PREFERENCES;
    const userId = await currentUserId();
    if (!userId) return DEFAULT_NOTIFICATION_PREFERENCES;
    const { data, error } = await supabase
      .from("user_preferences")
      .select("notification_preferences")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    const prefs = (data?.notification_preferences ?? {}) as Partial<NotificationPreferences>;
    return {
      leaveApprovals: prefs.leaveApprovals ?? true,
      payrollRuns: prefs.payrollRuns ?? true,
    };
  },
  async updateNotificationPreferences(input: NotificationPreferences) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const userId = await currentUserId();
    if (!userId) throw new Error("Not signed in.");
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        { user_id: userId, notification_preferences: input as unknown as Json },
        { onConflict: "user_id" },
      );
    if (error) throw error;
  },

  async betaUntil(): Promise<string | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await rpcClient().rpc("beta_status");
    if (error) throw error;
    return (data as string | null) ?? null;
  },
  async setBetaUntil(date: string | null): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await rpcClient().rpc("set_beta_until", { p_date: date });
    if (error) throw error;
  },
  async cronHealth(): Promise<CronJobHealth[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await rpcClient().rpc("cron_job_health");
    if (error) throw error;
    return ((data ?? []) as CronRow[]).map((r) => ({
      jobName: String(r.job_name),
      schedule: r.schedule ?? null,
      isScheduled: Boolean(r.is_scheduled),
      isActive: Boolean(r.is_active),
      lastRunAt: r.last_run_at ?? null,
      lastStatus: r.last_status ?? null,
      lastMessage: r.last_message ?? null,
    }));
  },
  /** Admin only. Wipes beta data in one DB transaction, then removes document files. */
  async resetBetaData(confirm: string): Promise<BetaResetResult> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await rpcClient().rpc("reset_beta_data", { p_confirm: confirm });
    if (error) throw error;
    const result = data as {
      counts: Record<string, number | string | null>;
      skipped_payroll_runs: { id: string; month: number; year: number }[];
      storage_paths: string[];
    };
    let storageRemoved = 0;
    let storageFailed = 0;
    const paths = (result.storage_paths ?? []).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error: removeError } = await supabase.storage.from("documents").remove(batch);
      if (removeError) storageFailed += batch.length;
      else storageRemoved += batch.length;
    }
    return {
      counts: result.counts ?? {},
      skippedPayrollRuns: result.skipped_payroll_runs ?? [],
      storageRemoved,
      storageFailed,
    };
  },
};

interface CronRow {
  job_name: string;
  schedule: string | null;
  is_scheduled: boolean;
  is_active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
}

export interface CronJobHealth {
  jobName: string;
  schedule: string | null;
  isScheduled: boolean;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
}

export interface BetaResetResult {
  counts: Record<string, number | string | null>;
  skippedPayrollRuns: { id: string; month: number; year: number }[];
  storageRemoved: number;
  storageFailed: number;
}

function rpcClient() {
  /* eslint-disable @typescript-eslint/no-explicit-any -- generated Database types do not know these functions */
  return supabase as unknown as {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: any; error: Error | null }>;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
