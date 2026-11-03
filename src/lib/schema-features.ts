/**
 * Recognises errors that mean "this database has not been migrated yet":
 * a function, table or column the app expects is missing. Callers use it to
 * fall back or hide a feature instead of showing a hard error.
 *
 * PGRST202: function not found in the schema cache
 * PGRST205 / 42P01: table not found
 * PGRST204 / 42703: column not found
 * 42883: function does not exist (raised from inside SQL)
 */
const MISSING_CODES = new Set(["PGRST202", "PGRST205", "PGRST204", "42P01", "42703", "42883"]);

export function isMissingDbObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MISSING_CODES.has(code)) return true;
  return (
    typeof message === "string" &&
    /could not find the (function|table)|schema cache|does not exist/i.test(message)
  );
}

const MISSING_TTL_MS = 5 * 60_000;
const missingKey = (name: string) => `hrms:db-missing:${name}`;

/**
 * Remember, for a few minutes in this browser tab, that a database function
 * is not installed, so every page load does not repeat a request that is
 * known to 404. Short-lived on purpose: once the migration is applied the
 * feature turns on within minutes, without anyone clearing anything.
 */
export function markDbObjectMissing(name: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(missingKey(name), String(Date.now() + MISSING_TTL_MS));
  } catch {
    // storage unavailable (private mode): fall back to in-memory flags
  }
}

export function isDbObjectKnownMissing(name: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const until = Number(window.sessionStorage.getItem(missingKey(name)) ?? 0);
    return until > Date.now();
  } catch {
    return false;
  }
}

/**
 * Assigning "general_manager" on a database without the GM migration fails
 * with the old role whitelist ("Invalid role." / "Choose a valid role." /
 * profiles_role_check). Returns a message that says what to do instead.
 */
export function gmRoleUnavailableMessage(role: string, error: unknown): string | null {
  if (role !== "general_manager" || !error || typeof error !== "object") return null;
  const message = String((error as { message?: unknown }).message ?? "");
  if (!/invalid role|valid role|profiles_role_check/i.test(message)) return null;
  return `The General Manager role is not installed in this database yet. Apply migration ${GM_CRM_MIGRATIONS[0]}, then try again.`;
}

/** The migrations that add the General Manager role and the Sales CRM. */
export const GM_CRM_MIGRATIONS = [
  "20261102100000_general_manager_role.sql",
  "20261102110000_sales_crm.sql",
] as const;
