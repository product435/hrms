import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;

// VITE_SUPABASE_KEY is the current/primary name for the publishable (anon)
// client key. VITE_SUPABASE_PUBLISHABLE_KEY and VITE_SUPABASE_ANON_KEY are
// kept as fallbacks so an environment still configured under either older
// name keeps working without a config change -- never the service_role/secret
// key, only the publishable/anon key belongs here.
export const SUPABASE_PUBLISHABLE_KEY = (import.meta.env["VITE_SUPABASE_KEY"] ??
  import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  import.meta.env["VITE_SUPABASE_ANON_KEY"]) as string | undefined;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// Presence-only configuration report -- never returns or logs an actual
// value, only whether each required variable was found and, for the key,
// which of the supported names supplied it. Safe to log in production.
export function getSupabaseConfigStatus() {
  const keySource = import.meta.env["VITE_SUPABASE_KEY"]
    ? "VITE_SUPABASE_KEY"
    : import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]
      ? "VITE_SUPABASE_PUBLISHABLE_KEY (fallback)"
      : import.meta.env["VITE_SUPABASE_ANON_KEY"]
        ? "VITE_SUPABASE_ANON_KEY (fallback)"
        : "none";
  return {
    urlPresent: Boolean(SUPABASE_URL),
    keyPresent: Boolean(SUPABASE_PUBLISHABLE_KEY),
    keySource,
    configured: isSupabaseConfigured,
  };
}

export type SupabaseClientLike = SupabaseClient<Database> | null;

/**
 * Browser-safe client. Credentials come only from Vite environment variables.
 *
 * Session storage uses cookies (via @supabase/ssr) instead of localStorage so
 * that the same session is visible to the server during SSR (see
 * `lib/supabase-server.ts`, used from `beforeLoad`). Without this, a browser
 * refresh triggers a fresh server render that can't see the localStorage
 * session and redirects to sign-in even though the user is still logged in.
 */
export const supabase: SupabaseClientLike = isSupabaseConfigured
  ? createBrowserClient<Database>(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!)
  : null;
