import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as
  | string
  | undefined;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

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
