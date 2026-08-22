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
};
