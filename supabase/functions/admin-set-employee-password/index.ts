// admin-set-employee-password: lets a Super Admin set another employee's
// sign-in password, creating that employee's Supabase Auth account first
// if one doesn't exist yet (e.g. an employee the admin added via "Add
// employee", who has never signed up). Creating the Auth user here is the
// ONLY new capability this function adds -- everything else (hashing the
// password, revoking old sessions, closing pending reset requests,
// notifying the employee, writing the audit log) is delegated to the
// existing admin_set_employee_password() SQL function, unchanged, so
// behavior for an employee who already has an account is identical to
// before.
//
// Secrets (already present for every Supabase project, never read from
// the browser): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//
// Caller: a signed-in user (JWT) who passes is_admin() -- checked twice,
// once here (so the service-role Admin API call below is never reached by
// a non-admin) and again inside admin_set_employee_password() itself,
// exactly as it already does for the existing-account path.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    password.length <= 72 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Server is not configured." }, 500);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const userRes = await userClient.auth.getUser(token);
  if (userRes.error || !userRes.data.user) return json({ error: "Not signed in." }, 401);

  const adminRes = await userClient.rpc("is_admin");
  if (adminRes.error || adminRes.data !== true) {
    return json({ error: "Only a Super Admin can change someone else's password." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const employeeId = String(body.employee_id ?? "");
  const password = String(body.password ?? "");
  if (!UUID_RE.test(employeeId)) return json({ error: "Choose an employee." }, 400);
  if (!isStrongPassword(password)) {
    return json({ error: "Password does not meet the requirements." }, 400);
  }

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Confirm the employee exists, belongs to the caller's organisation (the
  // same check admin_set_employee_password() makes), and read whether it
  // already has an Auth account. This duplicates part of that function's
  // own lookup, but only to decide whether account creation is needed --
  // the actual authorization and organisation check happen again, for
  // real, inside that function when it runs below.
  const orgRes = await userClient.rpc("current_org_id");
  const callerOrg = orgRes.data as string | null;
  if (!callerOrg) return json({ error: "Your account is not linked to an organisation." }, 403);

  const employeeRes = await service
    .from("employees")
    .select("id, organization_id, profile_id, email, first_name, last_name")
    .eq("id", employeeId)
    .maybeSingle();
  if (employeeRes.error) return json({ error: "Employee not found." }, 404);
  const employee = employeeRes.data;
  if (!employee) return json({ error: "Employee not found." }, 404);
  if (employee.organization_id !== callerOrg) {
    return json({ error: "That employee is not in your organisation." }, 403);
  }

  const email = (employee.email ?? "").trim().toLowerCase();

  let hasAccount = Boolean(employee.profile_id);
  if (!hasAccount && email) {
    // listUsers has no "find by email" filter in this SDK version; page
    // through once. Employee counts here are small (one organisation),
    // so a single 1000-row page covers every realistic project.
    const listRes = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listRes.error) return json({ error: "Could not check existing accounts." }, 500);
    hasAccount = listRes.data.users.some((u) => (u.email ?? "").toLowerCase() === email);
  }

  if (!hasAccount) {
    if (!email) {
      return json(
        { error: "This employee has no work email on file, so no sign-in account can be created." },
        400,
      );
    }
    const fullName = `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim();
    const createRes = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (createRes.error) {
      return json({ error: `Could not create a sign-in account: ${createRes.error.message}` }, 500);
    }
    // handle_new_user() (the on-auth-user-created trigger) links this new
    // Auth user to this exact employees row by matching email + profile_id
    // is null -- the same row we just read -- so profile_id is now set and
    // admin_set_employee_password() below finds it immediately. The
    // password is already correct from createUser(), but we still call
    // that function so the rest of its behavior (session revoke is a
    // no-op for a brand-new user, closing pending reset requests, the
    // "password changed" notification, and the audit log entry) happens
    // exactly as it does for an existing account, keeping one code path.
  }

  const setRes = await userClient.rpc("admin_set_employee_password", {
    p_employee_id: employeeId,
    p_password: password,
  });
  if (setRes.error) return json({ error: setRes.error.message }, 400);

  return json({ ok: true, createdAccount: !hasAccount });
});
