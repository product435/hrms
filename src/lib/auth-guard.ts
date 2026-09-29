import { redirect } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { employmentStatusForUser } from "@/services/onboardingService";
import {
  authService,
  consumeEmploymentBlockNotice,
  hasEmploymentBlockNotice,
  isEmploymentAccessError,
  rolesForPath,
  sessionForUser,
  type AuthSession,
} from "@/services/authService";
import { supabase } from "@/lib/supabase";

const PENDING_STATUSES = new Set(["pending_approval", "profile_changes_requested"]);

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
    } catch (error) {
      if (isEmploymentAccessError(error)) {
        await redirectBlockedEmployment();
        return null;
      }
      return null;
    }
  })
  .client(async (): Promise<AuthSession | null> => {
    let blocked = false;
    let session: AuthSession | null = null;
    try {
      session = await authService.initialize();
    } catch (error) {
      if (!isEmploymentAccessError(error)) return null;
      blocked = true;
      session = null;
    }
    if (!session && (blocked || hasEmploymentBlockNotice())) {
      await redirectBlockedEmployment();
    }
    return session;
  });

const currentPathname = createIsomorphicFn()
  .server(async (): Promise<string | null> => {
    try {
      const { getRequestUrl } = await import("@tanstack/react-start/server");
      return getRequestUrl().pathname.replace(/\/$/, "") || "/";
    } catch {
      return null;
    }
  })
  .client(async (): Promise<string> => window.location.pathname.replace(/\/$/, "") || "/");

const showingEmploymentBlock = createIsomorphicFn()
  .server(async (): Promise<boolean> => {
    try {
      const { getRequestUrl } = await import("@tanstack/react-start/server");
      const url = getRequestUrl();
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      return pathname === "/sign-in" && url.searchParams.get("blocked") === "employment";
    } catch {
      return false;
    }
  })
  .client(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const pathname = window.location.pathname.replace(/\/$/, "") || "/";
    return (
      pathname === "/sign-in" &&
      new URLSearchParams(window.location.search).get("blocked") === "employment"
    );
  });

async function redirectBlockedEmployment() {
  consumeEmploymentBlockNotice();
  if (await showingEmploymentBlock()) return;
  throw redirect({ to: "/sign-in", search: { blocked: "employment" } });
}

const employmentStatus = createIsomorphicFn()
  .server(async (session: AuthSession): Promise<string | null> => {
    const { createRequestSupabaseClient } = await import("@/lib/supabase-server");
    const client = createRequestSupabaseClient();
    if (!client) return null;
    return employmentStatusForUser(client, session.user.id);
  })
  .client(async (session: AuthSession): Promise<string | null> => {
    if (!supabase) return null;
    return employmentStatusForUser(supabase, session.user.id);
  });

function onboardingDestination(
  status: string | null,
  pathname: string,
): "/complete-profile" | "/profile-status" | null {
  if (status === "rejected") {
    return pathname === "/profile-status" ? null : "/profile-status";
  }
  if (status && PENDING_STATUSES.has(status)) {
    if (
      pathname === "/complete-profile" ||
      pathname === "/profile-status" ||
      pathname === "/sign-in"
    ) {
      return null;
    }
    return "/complete-profile";
  }
  return null;
}

async function enforceOnboardingGate(session: AuthSession) {
  const pathname = await currentPathname();
  if (!pathname) return;
  const status = await employmentStatus(session);
  const destination = onboardingDestination(status, pathname);
  if (destination) throw redirect({ to: destination });
}

export async function requireAuth() {
  const session = await getIsomorphicSession();
  if (!session) {
    const pathname = await currentPathname();
    throw redirect({
      to: "/sign-in",
      search: {
        redirect:
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : pathname && pathname !== "/"
              ? pathname
              : "/",
      },
    });
  }
  await enforceOnboardingGate(session);
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
  const session = await getIsomorphicSession();
  if (!session) return;
  const status = await employmentStatus(session);
  if (status === "rejected") throw redirect({ to: "/profile-status" });
  if (status && PENDING_STATUSES.has(status)) throw redirect({ to: "/complete-profile" });
  throw redirect({ to: "/" });
}
