import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import type { Role, SessionUser } from "@/types";

export interface AuthSession {
  user: SessionUser;
}
export interface AuthError {
  message: string;
}
export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}
type SessionListener = (session: AuthSession | null) => void;
type ProfileRow = {
  id: string;
  role?: string | null;
  role_id?: string | null;
  employee_id?: string | null;
  organization_id?: string | null;
  full_name?: string | null;
  email?: string | null;
  designation?: string | null;
  department?: string | null;
  avatar_url?: string | null;
};
type RoleRow = { name?: string | null };
type EmployeeRow = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  role?: string | null;
};

const listeners = new Set<SessionListener>();
let currentSession: AuthSession | null = null;
let supabaseSubscription: { unsubscribe: () => void } | null = null;

function writeSession(session: AuthSession | null) {
  currentSession = session;
  listeners.forEach((listener) => listener(session));
}

function roleFromValue(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return normalized === "admin" ||
    normalized === "hr" ||
    normalized === "manager" ||
    normalized === "employee"
    ? normalized
    : null;
}

async function sessionForUser(user: SupabaseUser | null): Promise<AuthSession | null> {
  if (!user) return null;
  const metadata = { ...user.app_metadata, ...user.user_metadata } as Record<string, unknown>;
  let profile: ProfileRow | null = null;
  let roleRecord: RoleRow | null = null;
  let employee: EmployeeRow | null = null;
  if (supabase) {
    const primary = await supabase
      .from("profiles")
      .select("id, role, employee_id, full_name, email, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    let profileData: unknown = primary.data;
    let profileError = primary.error;
    if (profileError) {
      // Keep compatibility with the newer role_id-based schema without requiring it.
      const fallback = await supabase
        .from("profiles")
        .select("id, role_id, full_name, email, designation, department, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      profileData = fallback.data;
      profileError = fallback.error;
    }
    if (profileError) throw profileError;
    profile = profileData as ProfileRow | null;

    if (profile?.role_id) {
      const { data: role, error: roleError } = await supabase
        .from("roles")
        .select("name")
        .eq("id", profile.role_id)
        .maybeSingle();
      if (roleError) throw roleError;
      roleRecord = role as RoleRow | null;
    }

    if (profile && user.email) {
      const { data: employeeRow } = await supabase
        .from("employees")
        .select("first_name, last_name, email")
        .or(`profile_id.eq.${user.id},email.eq.${user.email}`)
        .maybeSingle();
      employee = employeeRow as EmployeeRow | null;
    }
  }

  if (!profile) {
    throw new Error(
      "No profile record was found for this Supabase user. Contact an administrator.",
    );
  }
  const role = roleFromValue(profile.role) ?? roleFromValue(roleRecord?.name);
  if (!role) {
    throw new Error("Your profile is missing a valid application role. Contact an administrator.");
  }
  const fallbackName =
    (typeof metadata["full_name"] === "string" && metadata["full_name"]) ||
    (employee?.first_name && employee.last_name
      ? `${employee.first_name} ${employee.last_name}`
      : undefined) ||
    profile.full_name ||
    user.email?.split("@")[0] ||
    "Kinetix user";
  const avatarUrl = profile.avatar_url ?? employee?.avatar_url;
  return {
    user: {
      id: user.id,
      name: profile?.full_name || fallbackName,
      email: user.email ?? profile.email ?? employee?.email ?? "",
      role,
      designation: profile?.designation ?? "",
      department: profile?.department ?? "",
      ...(avatarUrl ? { avatarUrl } : {}),
    },
  };
}

function ensureSupabaseListener() {
  if (!supabase || supabaseSubscription) return;
  supabaseSubscription = supabase.auth.onAuthStateChange((_event, session) => {
    void sessionForUser(session?.user ?? null)
      .then(writeSession)
      .catch(() => writeSession(null));
  }).data.subscription;
}

async function initializeSession() {
  if (!supabase) {
    currentSession = null;
    return null;
  }
  ensureSupabaseListener();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  let session: AuthSession | null = null;
  try {
    session = await sessionForUser(data.session?.user ?? null);
  } catch {
    session = null;
  }
  writeSession(session);
  return session;
}

export const ROUTE_ROLES: Record<string, Role[]> = {
  "/": ["admin", "hr", "manager", "employee"],
  "/announcements": ["admin", "hr", "manager", "employee"],
  "/notifications": ["admin", "hr", "manager", "employee"],
  "/employees": ["admin", "hr", "manager"],
  "/employees/$employeeId": ["admin", "hr", "manager", "employee"],
  "/departments": ["admin", "hr", "manager"],
  "/designations": ["admin", "hr", "manager"],
  "/onboarding": ["admin", "hr"],
  "/recruitment": ["admin", "hr"],
  "/attendance": ["admin", "hr", "manager", "employee"],
  "/shifts": ["admin", "hr", "manager"],
  "/leave": ["admin", "hr", "manager", "employee"],
  "/payroll": ["admin", "hr", "employee"],
  "/expenses": ["admin", "hr", "manager", "employee"],
  "/goals": ["admin", "hr", "manager", "employee"],
  "/performance": ["admin", "hr", "manager"],
  "/assets": ["admin", "hr", "manager", "employee"],
  "/documents": ["admin", "hr", "manager", "employee"],
  "/helpdesk": ["admin", "hr", "manager", "employee"],
  "/reports": ["admin", "hr", "manager"],
  "/audit": ["admin", "hr"],
  "/settings": ["admin", "hr"],
};

export function rolesForPath(pathname: string): Role[] | null {
  if (pathname === "/") return ROUTE_ROLES["/"] ?? null;
  if (pathname.startsWith("/employees/") && pathname !== "/employees/")
    return ROUTE_ROLES["/employees/$employeeId"] ?? null;
  const match = Object.keys(ROUTE_ROLES)
    .filter((route) => route !== "/")
    .sort((a, b) => b.length - a.length)
    .find((route) => pathname === route || pathname.startsWith(`${route}/`));
  return match ? (ROUTE_ROLES[match] ?? null) : null;
}

export const authService = {
  getSession(): AuthSession | null {
    return currentSession;
  },
  async initialize() {
    return initializeSession();
  },
  onSessionChange(listener: SessionListener) {
    listeners.add(listener);
    ensureSupabaseListener();
    return () => listeners.delete(listener);
  },
  async signIn(email: string, password: string): Promise<{ error?: AuthError }> {
    if (!isSupabaseConfigured || !supabase)
      return {
        error: {
          message: "Supabase Auth is not configured. Add the required Vite environment variables.",
        },
      };
    if (!email.trim() || !password) return { error: { message: "Enter your email and password." } };
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      const message = /invalid login credentials/i.test(error.message)
        ? "The email or password is incorrect. Check your credentials and try again."
        : error.message;
      return { error: { message } };
    }
    try {
      writeSession(await sessionForUser(data.user));
    } catch (sessionError) {
      await supabase.auth.signOut();
      return {
        error: {
          message:
            sessionError instanceof Error
              ? sessionError.message
              : "Your account profile is incomplete.",
        },
      };
    }
    return {};
  },
  async signUp(
    input: SignUpInput,
  ): Promise<{ error?: AuthError; needsEmailConfirmation?: boolean }> {
    if (!isSupabaseConfigured || !supabase)
      return {
        error: {
          message: "Supabase Auth is not configured. Add the required Vite environment variables.",
        },
      };
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { full_name: input.name.trim() } },
    });
    if (error) return { error: { message: error.message } };
    if (data.session && data.user) {
      try {
        writeSession(await sessionForUser(data.user));
      } catch (sessionError) {
        writeSession(null);
        return {
          error: {
            message: `Supabase user created, but the application profile could not be loaded: ${sessionError instanceof Error ? sessionError.message : "unknown profile error"}`,
          },
        };
      }
    }
    return { needsEmailConfirmation: !data.session };
  },
  async resetPasswordForEmail(email: string): Promise<{ error?: AuthError; success?: boolean }> {
    if (!isSupabaseConfigured || !supabase)
      return {
        error: {
          message: "Supabase Auth is not configured. Add the required Vite environment variables.",
        },
      };
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      redirectTo ? { redirectTo } : undefined,
    );
    return error ? { error: { message: error.message } } : { success: true };
  },
  async updatePassword(password: string): Promise<{ error?: AuthError; success?: boolean }> {
    if (!isSupabaseConfigured || !supabase)
      return {
        error: {
          message: "Supabase Auth is not configured. Add the required Vite environment variables.",
        },
      };
    const { error } = await supabase.auth.updateUser({ password });
    return error ? { error: { message: error.message } } : { success: true };
  },
  async signOut() {
    writeSession(null);
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // The local session is already cleared so the UI can redirect immediately.
      }
    }
  },
};
