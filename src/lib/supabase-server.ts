import { createServerClient } from "@supabase/ssr";
import {
  deleteCookie,
  getCookies,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  isSupabaseConfigured,
  getSupabaseConfigStatus,
  type SupabaseClientLike,
} from "./supabase";
import type { Database } from "@/types/database";

// Logged once, on the first real request rather than at module load, so a
// misconfigured deployment (wrong env var name, missing value) is visible in
// server logs immediately -- without ever printing the URL or key itself.
// Deferred to first-use rather than eager top-level execution, matching the
// circular-chunk-import lesson from the CSRF middleware fix.
let loggedConfigStatus = false;

/**
 * Server-only. Builds a Supabase client bound to the current request's
 * cookies so `beforeLoad` can see the same session the browser client wrote
 * (see `lib/supabase.ts`). Must be called fresh for every request — never
 * cache or reuse the returned client, since it carries one request's auth
 * state and this module can be reused across requests by the server runtime.
 */
export function createRequestSupabaseClient(): SupabaseClientLike {
  if (!loggedConfigStatus) {
    loggedConfigStatus = true;
    const status = getSupabaseConfigStatus();
    if (!status.configured) {
      console.error(
        `[supabase] Not configured: urlPresent=${status.urlPresent} keyPresent=${status.keyPresent}. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.`,
      );
    } else {
      console.log(`[supabase] Configured (key from ${status.keySource}).`);
    }
  }
  if (!isSupabaseConfigured) return null;
  return createServerClient<Database>(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        const cookies = getCookies();
        return Object.entries(cookies).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (value) {
            setCookie(name, value, options);
          } else {
            deleteCookie(name, options);
          }
        });
        Object.entries(headers).forEach(([key, value]) => {
          setResponseHeader(key, value);
        });
      },
    },
  });
}
