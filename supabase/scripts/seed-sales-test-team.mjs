// Creates a "Sales Team" test department (is_sales = true) and two test
// employees in it -- one `team_lead` and one `employee` -- so the Sales CRM's
// RLS and role separation can be exercised end-to-end. Mirrors the existing
// prepare-test-users.mjs pattern: service-role key, idempotent, no raw SQL.
// Does not touch any other department, employee, or CRM record.

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
      "This script needs a Supabase admin key to create Auth users and flag a department.",
  );
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEPARTMENT_NAME = "Sales Team";
const salesUsers = [
  {
    email: "sales.lead@test.com",
    password: "SalesLead@1234",
    role: "team_lead",
    fullName: "Sales Lead",
  },
  {
    email: "sales.rep@test.com",
    password: "SalesRep@1234",
    role: "employee",
    fullName: "Sales Rep",
  },
];

async function firstRow(table, columns, filters = {}) {
  let query = admin.from(table).select(columns).limit(1);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

const organization = await firstRow("organizations", "id", {});
if (!organization?.id) {
  throw new Error("No organization exists yet. Run the existing seed migration first.");
}

// 1. Ensure the "Sales Team" department exists and is flagged is_sales.
let department = await firstRow("departments", "id, name, is_sales", {
  organization_id: organization.id,
  name: DEPARTMENT_NAME,
});

if (!department) {
  const { data: created, error: createError } = await admin
    .from("departments")
    .insert({ organization_id: organization.id, name: DEPARTMENT_NAME })
    .select("id, name, is_sales")
    .single();
  if (createError) throw createError;
  department = created;
  console.log(`Created department "${DEPARTMENT_NAME}" (is_sales set by its own insert trigger)`);
}

if (!department.is_sales) {
  // Reuses the real authorization path (admin/HR only) rather than a raw UPDATE.
  const { error: flagError } = await admin.rpc("set_department_sales_flag", {
    p_department_id: department.id,
    p_is_sales: true,
  });
  if (flagError) throw flagError;
  console.log(`Flagged "${DEPARTMENT_NAME}" as a sales department via set_department_sales_flag`);
} else {
  console.log(`"${DEPARTMENT_NAME}" is already a sales department`);
}

// 2. Create (or reuse) each Auth user, then its profile and employee row.
const { data: existingUsersPage, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) throw listError;

for (const user of salesUsers) {
  let authUser = existingUsersPage.users.find(
    (candidate) => candidate.email?.toLowerCase() === user.email,
  );

  if (!authUser) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    });
    if (createError) throw createError;
    authUser = created.user;
    console.log(`Created Auth user ${user.email}`);
  } else {
    const { error: passwordError } = await admin.auth.admin.updateUserById(authUser.id, {
      password: user.password,
    });
    if (passwordError) throw passwordError;
  }

  const { data: existingProfile, error: profileLookupError } = await admin
    .from("profiles")
    .select("id, employee_id")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileLookupError) throw profileLookupError;

  let profile = existingProfile;
  if (!profile) {
    const { data: created, error: profileCreateError } = await admin
      .from("profiles")
      .insert({
        id: authUser.id,
        full_name: user.fullName,
        email: user.email,
        role: user.role,
        is_active: true,
      })
      .select("id, employee_id")
      .single();
    if (profileCreateError) throw profileCreateError;
    profile = created;
  } else {
    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({ role: user.role, is_active: true })
      .eq("id", authUser.id);
    if (profileUpdateError) throw profileUpdateError;
  }

  let employee = await firstRow("employees", "id, profile_id, department_id", {
    profile_id: authUser.id,
  });
  if (!employee) {
    const [firstName, ...rest] = user.fullName.split(" ");
    const { data: created, error: employeeCreateError } = await admin
      .from("employees")
      .insert({
        organization_id: organization.id,
        profile_id: authUser.id,
        department_id: department.id,
        employee_code: `SALES-${authUser.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
        first_name: firstName || "Sales",
        last_name: rest.join(" ") || "Test",
        email: user.email,
        employment_type: "full-time",
        joining_date: new Date().toISOString().slice(0, 10),
      })
      .select("id, profile_id, department_id")
      .single();
    if (employeeCreateError) throw employeeCreateError;
    employee = created;
  } else if (employee.department_id !== department.id) {
    const { error: deptUpdateError } = await admin
      .from("employees")
      .update({ department_id: department.id })
      .eq("id", employee.id);
    if (deptUpdateError) throw deptUpdateError;
  }

  if (profile.employee_id !== employee.id) {
    const { error: linkError } = await admin
      .from("profiles")
      .update({ employee_id: employee.id })
      .eq("id", authUser.id);
    if (linkError) throw linkError;
  }

  console.log(`Prepared ${user.email} as ${user.role} in "${DEPARTMENT_NAME}" (employee ${employee.id})`);
}

console.log("\nDone. Sign in as sales.rep@test.com / sales.lead@test.com to test Sales CRM access.");
