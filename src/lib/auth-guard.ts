import { redirect } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { authService, rolesForPath, sessionForUser, type AuthSession } from "@/services/authService";

/**
 * Resolves the current session on whichever side `beforeLoad` is running.
 *
 * On the client this is the existing browser flow (localStorage/cookie
 * session via the shared Supabase client). On the server — i.e. a fresh SSR
 * request such as a browser refresh — there is no browser client instance to
 * read from, so a request-scoped Supabase client is built from the incoming
 * cookies instead. Both paths write the same session shape and share the
 * same profile/role lookup (`sessionForUser`), so behavior stays identical
 * once the client takes over after hydration.
 */
const getIsomorphicSession = createIsomorphicFn()
  .server(async (): Promise<AuthSession | null> => {
    const { createRequestSupabaseClient } = await import("@/lib/supabase-server");
    const client = createRequestSupabaseClient();
    if (!client) return null;
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return null;
      return await sessionForUser(client, data.user);
    } catch {
      return null;
    }
  })
  .client(async (): Promise<AuthSession | null> => authService.initialize());

export async function requireAuth() {
  const session = await getIsomorphicSession();
  if (!session) {
    throw redirect({
      to: "/sign-in",
      search: {
        redirect:
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : "/",
      },
    });
  }
  return session;
}

export async function requireAuthForPath(pathname: string) {
  const session = await requireAuth();
  const allowed = rolesForPath(pathname);
  if (allowed && !allowed.includes(session.user.role)) {
    throw redirect({ to: "/unauthorized" });
  }
  return session;
}

export async function redirectIfAuthenticated() {
  if (await getIsomorphicSession()) {
    throw redirect({ to: "/" });
  }
}
