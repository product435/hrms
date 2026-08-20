import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as
  | string
  | undefined;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export type SupabaseClientLike = SupabaseClient | null;

/** Browser-safe client. Credentials come only from Vite environment variables. */
export const supabase: SupabaseClientLike = isSupabaseConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
