import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadLocalEnv() {
  const envPath = resolve(fileURLToPath(new URL("../..", import.meta.url)), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // The shell may provide the variables directly; keep that path working.
  }
}

loadLocalEnv();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in the shell or .env.local. " +
      "This preparation script needs a Supabase admin key to list Auth users and reset passwords.",
  );
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const users = [
  { email: "admin@test.com", password: "Admin@1234", role: "admin" },
  { email: "hr@test.com", password: "Hr@12345", role: "hr" },
  { email: "manager@test.com", password: "Manager@1234", role: "manager" },
  { email: "employee@test.com", password: "Employee@1234", role: "employee" },
];

function splitName(user, fallback) {
  const name = String(user.user_metadata?.full_name ?? fallback).trim() || fallback;
  const [firstName, ...rest] = name.split(/\s+/);
  return { firstName: firstName || "Test", lastName: rest.join(" ") || "User" };
}

async function firstRow(table, columns, filters = {}) {
  let query = admin.from(table).select(columns).limit(1);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureProfile(authUser, expected) {
  const { data: existing, error } = await admin
    .from("profiles")
    .select("id, employee_id")
    .eq("id", authUser.id)
    .maybeSingle();
  if (error) throw error;

  if (!existing) {
    const { data: created, error: createError } = await admin
      .from("profiles")
      .insert({
        id: authUser.id,
        full_name: authUser.user_metadata?.full_name ?? expected.email.split("@")[0],
        email: expected.email,
        role: expected.role,
        is_active: true,
      })
      .select("id, employee_id")
      .single();
    if (createError) throw createError;
    return created;
  }

  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: expected.role, email: expected.email, is_active: true })
    .eq("id", authUser.id);
  if (roleError) throw roleError;
  return existing;
}

async function ensureEmployee(authUser, expected, profile) {
  let { data: employee, error } = await admin
    .from("employees")
    .select("id, profile_id")
    .eq("profile_id", authUser.id)
    .maybeSingle();
  if (error) throw error;

  if (!employee) {
    const byEmail = await admin
      .from("employees")
      .select("id, profile_id")
      .eq("email", expected.email)
      .limit(1)
      .maybeSingle();
    if (byEmail.error) throw byEmail.error;
    employee = byEmail.data;
  }

  if (!employee) {
    const organization = await firstRow("organizations", "id", {});
    if (!organization?.id) {
      throw new Error(
        `Cannot create employee for ${expected.email}: no organization exists. Run the existing seed migration first.`,
      );
    }

    const { firstName, lastName } = splitName(authUser, expected.email.split("@")[0]);
    const { data: created, error: createError } = await admin
      .from("employees")
      .insert({
        organization_id: organization.id,
        profile_id: authUser.id,
        employee_code: `TEST-${authUser.id.replaceAll("-", "").slice(0, 10).toUpperCase()}`,
        first_name: firstName,
        last_name: lastName,
        email: expected.email,
        employment_type: "full-time",
        joining_date: new Date().toISOString().slice(0, 10),
      })
      .select("id, profile_id")
      .single();
    if (createError) throw createError;
    employee = created;
  } else if (employee.profile_id !== authUser.id) {
    const { error: linkError } = await admin
      .from("employees")
      .update({ profile_id: authUser.id })
      .eq("id", employee.id);
    if (linkError) throw linkError;
  }

  if (profile.employee_id !== employee.id) {
    const { error: profileLinkError } = await admin
      .from("profiles")
      .update({ employee_id: employee.id })
      .eq("id", authUser.id);
    if (profileLinkError) throw profileLinkError;
  }
  return employee;
}

const allUsers = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  allUsers.push(...data.users);
  if (data.users.length < 1000) break;
}

for (const expected of users) {
  const authUser = allUsers.find((user) => user.email?.toLowerCase() === expected.email);
  if (!authUser) throw new Error(`Missing existing Auth user: ${expected.email}. No user was created.`);

  const profile = await ensureProfile(authUser, expected);
  const employee = await ensureEmployee(authUser, expected, profile);
  const { error: passwordError } = await admin.auth.admin.updateUserById(authUser.id, {
    password: expected.password,
  });
  if (passwordError) throw passwordError;

  console.log(`Prepared ${expected.email} as ${expected.role} (employee ${employee.id})`);
}
