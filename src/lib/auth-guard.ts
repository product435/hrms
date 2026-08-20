import { redirect } from "@tanstack/react-router";
import { authService, rolesForPath } from "@/services/authService";

export async function requireAuth() {
  const session = await authService.initialize();
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
  if (await authService.initialize()) {
    throw redirect({ to: "/" });
  }
}
