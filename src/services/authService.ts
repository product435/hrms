import { isSupabaseConfigured, supabase, type SupabaseClientLike } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { ATTENDANCE_ROUTE_ROLES } from "@/lib/nav-fragments/attendance";
import { kraNavItem } from "@/lib/nav-fragments/kra";
import { onboardingRouteRoles } from "@/lib/nav-fragments/onboarding";
import { projectsNavItem } from "@/lib/nav-fragments/projects";
import { workNavItem } from "@/lib/nav-fragments/work";
import { ALL_ROLES, normalizeRole, STAFF_ROLES } from "@/lib/roles";
import type { Role, SessionUser } from "@/types";
import { isValidEmail, sanitizeEmail } from "@/lib/email";
import { isStrongPassword } from "@/lib/password";
import { logAudit } from "./api";

// Supabase auth errors carry a machine-readable `code` in current supabase-js
// versions, but that's not guaranteed across every version/error path, so
// this also falls back to matching the message text.
function mapAuthError(error: {
  message: string;
  code?: string | undefined;
  status?: number | undefined;
}): string {
  const code = error.code ?? "";
  const msg = error.message ?? "";
  if (code === "email_address_invalid" || /email.*invalid|invalid.*email/i.test(msg)) {
    return "This email address isn't accepted. Double-check it and try again.";
  }
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    /rate limit/i.test(msg)
  ) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (code === "email_not_confirmed") {
    return "Confirm your email address before continuing. Check your inbox for the confirmation link.";
  }
  if (/failed to fetch|network|timeout/i.test(msg)) {
    return "Network error reaching the authentication service. Check your connection and try again.";
  }
  if (/redirect|url not allowed/i.test(msg)) {
    return "The application's authentication redirect isn't configured correctly. Contact an administrator.";
  }
  return msg || "Something went wrong. Please try again.";
}

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
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  role?: string | null;
};

const listeners = new Set<SessionListener>();
let currentSession: AuthSession | null = null;
let supabaseSubscription: { unsubscribe: () => void } | null = null;
let signOutInProgress = false;
let sessionEpoch = 0;
let signOutPromise: Promise<{ error?: AuthError }> | null = null;
let employmentBlockNotice: string | null = null;

const BLOCKED_EMPLOYMENT_STATUSES = new Set([
  "resigned",
  "terminated",
  "inactive",
  "rejected",
  "exited",
  "suspended",
]);

export const EMPLOYMENT_BLOCKED_MESSAGE =
  "This account cannot sign in because the employee is not allowed to work. Contact an administrator.";

export class EmploymentAccessError extends Error {
  constructor() {
    super(EMPLOYMENT_BLOCKED_MESSAGE);
    this.name = "EmploymentAccessError";
  }
}

export function isEmploymentAccessError(error: unknown): error is EmploymentAccessError {
  return (
    error instanceof EmploymentAccessError ||
    (error instanceof Error && error.name === "EmploymentAccessError")
  );
}

export function hasEmploymentBlockNotice(): boolean {
  return employmentBlockNotice !== null;
}

export function consumeEmploymentBlockNotice(): string | null {
  const notice = employmentBlockNotice;
  employmentBlockNotice = null;
  return notice;
}

function normalizeEmploymentStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return status || null;
}

async function linkedEmploymentStatus(
  client: NonNullable<SupabaseClientLike>,
  userId: string,
  employeeId?: string | null,
): Promise<string | null> {
  const byProfile = await client
    .from("employees")
    .select("employment_status")
    .eq("profile_id", userId)
    .maybeSingle();
  if (!byProfile.error) {
    const status = normalizeEmploymentStatus(byProfile.data?.employment_status);
    if (status) return status;
  }
  if (!employeeId) return null;
  const byId = await client
    .from("employees")
    .select("employment_status")
    .eq("id", employeeId)
    .maybeSingle();
  if (byId.error) return null;
  return normalizeEmploymentStatus(byId.data?.employment_status);
}

async function denyEmploymentAccess(client: NonNullable<SupabaseClientLike>): Promise<never> {
  if (typeof window !== "undefined") {
    employmentBlockNotice = EMPLOYMENT_BLOCKED_MESSAGE;
    signOutInProgress = true;
  }
  try {
    await client.auth.signOut();
  } catch {
    // The block still applies when the auth call fails.
  } finally {
    if (typeof window !== "undefined") {
      signOutInProgress = false;
      writeSession(null);
    }
  }
  throw new EmploymentAccessError();
}

const recoveryModuleStarted = Date.now();

function locationHasRecoveryCredentials(): boolean {
  if (typeof window === "undefined") return false;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  const type = hash.get("type") ?? search.get("type");
  if (type !== "recovery") return false;
  return Boolean(
    hash.get("access_token") ||
    hash.get("token") ||
    hash.get("token_hash") ||
    search.get("code") ||
    search.get("token") ||
    search.get("token_hash"),
  );
}

const recoveryCredentialsOnStartup = locationHasRecoveryCredentials();
let recoveryEventAt = 0;

function noteRecoveryEvent() {
  recoveryEventAt = Date.now();
}

export function hasPasswordRecoveryEvent(): boolean {
  return recoveryEventAt > 0 && Date.now() - recoveryEventAt < 60_000;
}

export function openedWithRecoveryCredentials(): boolean {
  return recoveryCredentialsOnStartup;
}

export function passwordRecoveryRedirect(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const url = new URL("/reset-password", window.location.origin);
  url.searchParams.set("type", "recovery");
  return url.toString();
}

if (typeof window !== "undefined" && supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      noteRecoveryEvent();
      return;
    }
    if (
      event === "SIGNED_IN" &&
      recoveryCredentialsOnStartup &&
      Date.now() - recoveryModuleStarted < 15_000
    ) {
      noteRecoveryEvent();
    }
  });
}

function writeSession(session: AuthSession | null) {
  currentSession = session;
  listeners.forEach((listener) => listener(session));
}

function roleFromValue(value: unknown): Role | null {
  return normalizeRole(value);
}

export async function sessionForUser(
  client: SupabaseClientLike,
  user: SupabaseUser | null,
): Promise<AuthSession | null> {
  if (!user) return null;
  const metadata = { ...user.app_metadata, ...user.user_metadata } as Record<string, unknown>;
  let profile: ProfileRow | null = null;
  let roleRecord: RoleRow | null = null;
  let employee: EmployeeRow | null = null;
  if (client) {
    const primary = await client
      .from("profiles")
      .select("id, role, employee_id, full_name, email, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    let profileData: unknown = primary.data;
    let profileError = primary.error;
    if (profileError) {
      // Keep compatibility with the newer role_id-based schema without requiring it.
      const fallback = await client
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
      const { data: role, error: roleError } = await client
        .from("roles")
        .select("name")
        .eq("id", profile.role_id)
        .maybeSingle();
      if (roleError) throw roleError;
      roleRecord = role as RoleRow | null;
    }

    if (profile && user.email) {
      const { data: employeeRow } = await client
        .from("employees")
        .select("id, first_name, last_name, email")
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
  if (client) {
    const employmentStatus = await linkedEmploymentStatus(client, user.id, profile.employee_id);
    if (employmentStatus && BLOCKED_EMPLOYMENT_STATUSES.has(employmentStatus)) {
      await denyEmploymentAccess(client);
    }
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
    "JeeVijay HRMS user";
  const avatarUrl = profile.avatar_url ?? employee?.avatar_url;
  const employeeId = profile.employee_id ?? employee?.id ?? undefined;
  return {
    user: {
      id: user.id,
      name: profile?.full_name || fallbackName,
      email: user.email ?? profile.email ?? employee?.email ?? "",
      role,
      designation: profile?.designation ?? "",
      department: profile?.department ?? "",
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(employeeId ? { employeeId } : {}),
    },
  };
}

function ensureSupabaseListener() {
  if (!supabase || supabaseSubscription) return;
  supabaseSubscription = supabase.auth.onAuthStateChange((_event, session) => {
    if (signOutInProgress) return;
    const epoch = sessionEpoch;
    void sessionForUser(supabase, session?.user ?? null)
      .then((next) => {
        if (signOutInProgress || epoch !== sessionEpoch) return;
        writeSession(next);
      })
      .catch(() => {
        if (signOutInProgress || epoch !== sessionEpoch) return;
        writeSession(null);
      });
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
    session = await sessionForUser(supabase, data.session?.user ?? null);
  } catch (error) {
    writeSession(null);
    if (isEmploymentAccessError(error)) throw error;
    session = null;
  }
  writeSession(session);
  return session;
}

export const ROUTE_ROLES: Record<string, Role[]> = {
  "/": ALL_ROLES,
  "/announcements": ALL_ROLES,
  "/notifications": ALL_ROLES,
  "/employees": STAFF_ROLES,
  "/employees/$employeeId": ALL_ROLES,
  "/departments": STAFF_ROLES,
  "/designations": STAFF_ROLES,
  "/onboarding": ["admin", "hr"],
  "/recruitment": ["admin", "hr"],
  "/attendance": ATTENDANCE_ROUTE_ROLES,
  "/work": workNavItem.roles,
  "/projects": projectsNavItem.roles,
  "/shifts": STAFF_ROLES,
  "/leave": ALL_ROLES,
  "/payroll": ["admin", "hr", "employee"],
  "/expenses": ALL_ROLES,
  "/goals": ALL_ROLES,
  "/performance": ALL_ROLES,
  "/kra": kraNavItem.roles,
  "/assets": ALL_ROLES,
  "/documents": ALL_ROLES,
  "/helpdesk": ALL_ROLES,
  "/reports": STAFF_ROLES,
  "/roles": ["admin"],
  "/audit": ["admin", "hr"],
  "/settings": STAFF_ROLES,
  "/complete-profile": onboardingRouteRoles["/complete-profile"] ?? ALL_ROLES,
  "/profile-status": onboardingRouteRoles["/profile-status"] ?? ALL_ROLES,
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
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail || !password) return { error: { message: "Enter your email and password." } };
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error) {
      const message = /invalid login credentials/i.test(error.message)
        ? "The email or password is incorrect. Check your credentials and try again."
        : mapAuthError(error);
      return { error: { message } };
    }
    try {
      writeSession(await sessionForUser(supabase, data.user));
    } catch (sessionError) {
      consumeEmploymentBlockNotice();
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
    void logAudit("auth_sign_in", "profiles", data.user.id);
    return {};
  },
  async signUp(
    _input: SignUpInput,
  ): Promise<{ error?: AuthError; needsEmailConfirmation?: boolean }> {
    return {
      error: {
        message: "Public sign-up is closed. Accounts are created by an administrator.",
      },
    };
  },
  async resetPasswordForEmail(email: string): Promise<{ error?: AuthError; success?: boolean }> {
    if (!isSupabaseConfigured || !supabase)
      return {
        error: {
          message: "Supabase Auth is not configured. Add the required Vite environment variables.",
        },
      };
    // Only the raw address is ever sent to Supabase -- no markdown/mailto
    // formatting, no surrounding quotes -- and it's validated as a plausible
    // email before the request is even made.
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail) return { error: { message: "Enter your email address." } };
    if (!isValidEmail(cleanEmail)) return { error: { message: "Enter a valid email address." } };
    const redirectTo = passwordRecoveryRedirect();
    const { error } = await supabase.auth.resetPasswordForEmail(
      cleanEmail,
      redirectTo ? { redirectTo } : undefined,
    );
    return error ? { error: { message: mapAuthError(error) } } : { success: true };
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
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ error?: AuthError; success?: boolean }> {
    if (!isSupabaseConfigured || !supabase)
      return {
        error: {
          message: "Supabase Auth is not configured. Add the required Vite environment variables.",
        },
      };
    if (!currentPassword) return { error: { message: "Enter your current password." } };
    if (!isStrongPassword(newPassword)) {
      return { error: { message: "Password does not meet the requirements." } };
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (userError || !email) {
      return { error: { message: "Sign in again before changing your password." } };
    }
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyError) {
      const message = /invalid login credentials/i.test(verifyError.message)
        ? "Current password is incorrect."
        : mapAuthError(verifyError);
      return { error: { message } };
    }
    return this.updatePassword(newPassword);
  },
  async signOut(options?: {
    scope?: "global" | "local" | "others";
  }): Promise<{ error?: AuthError }> {
    if (signOutPromise) return signOutPromise;
    const scope = options?.scope;

    signOutPromise = (async () => {
      signOutInProgress = true;
      sessionEpoch += 1;
      try {
        // Logged while the JWT is still valid so current_org_id() can resolve
        // the actor. The RPC is best-effort internally and never blocks a
        // successful logout with an audit-only failure.
        await logAudit("auth_sign_out", "profiles");

        if (supabase) {
          const { error } = await supabase.auth.signOut(scope ? { scope } : undefined);
          if (error) return { error: { message: mapAuthError(error) } };
        }

        // createBrowserClient stores the Supabase session in cookies. A
        // successful signOut removes those cookies; this explicit write also
        // updates every in-memory SessionProvider listener synchronously.
        writeSession(null);
        return {};
      } catch (error) {
        return {
          error: {
            message: mapAuthError({
              message: error instanceof Error ? error.message : "Sign out failed.",
            }),
          },
        };
      } finally {
        signOutInProgress = false;
        signOutPromise = null;
      }
    })();

    return signOutPromise;
  },
};
