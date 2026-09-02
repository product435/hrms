import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Role = "Admin" | "HR" | "Manager" | "Employee";
const vars: Record<Role, [string, string]> = {
  Admin: ["E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"],
  HR: ["E2E_HR_EMAIL", "E2E_HR_PASSWORD"],
  Manager: ["E2E_MANAGER_EMAIL", "E2E_MANAGER_PASSWORD"],
  Employee: ["E2E_EMPLOYEE_EMAIL", "E2E_EMPLOYEE_PASSWORD"],
};

const readable: Record<Role, string[]> = {
  Admin: [
    "announcements",
    "assets",
    "asset_assignments",
    "asset_repairs",
    "asset_requests",
    "attendance_records",
    "audit_logs",
    "candidates",
    "departments",
    "designations",
    "documents",
    "employees",
    "expense_claims",
    "goals",
    "helpdesk_tickets",
    "job_applications",
    "job_openings",
    "leave_ledger",
    "leave_requests",
    "leave_types",
    "notifications",
    "onboarding_records",
    "onboarding_tasks",
    "payroll_records",
    "payroll_runs",
    "payslips",
    "performance_reviews",
    "profiles",
    "shifts",
    "user_preferences",
  ],
  HR: [
    "announcements",
    "assets",
    "asset_assignments",
    "asset_repairs",
    "asset_requests",
    "attendance_records",
    "audit_logs",
    "candidates",
    "departments",
    "designations",
    "documents",
    "employees",
    "expense_claims",
    "goals",
    "helpdesk_tickets",
    "job_applications",
    "job_openings",
    "leave_ledger",
    "leave_requests",
    "leave_types",
    "notifications",
    "onboarding_records",
    "onboarding_tasks",
    "payroll_records",
    "payroll_runs",
    "payslips",
    "performance_reviews",
    "profiles",
    "shifts",
    "user_preferences",
  ],
  Manager: [
    "announcements",
    "assets",
    "asset_assignments",
    "asset_repairs",
    "asset_requests",
    "attendance_records",
    "departments",
    "designations",
    "documents",
    "employees",
    "expense_claims",
    "goals",
    "helpdesk_tickets",
    "job_openings",
    "leave_ledger",
    "leave_requests",
    "leave_types",
    "notifications",
    "performance_reviews",
    "profiles",
    "shifts",
    "user_preferences",
  ],
  Employee: [
    "announcements",
    "assets",
    "asset_assignments",
    "asset_repairs",
    "asset_requests",
    "attendance_records",
    "departments",
    "designations",
    "documents",
    "employees",
    "expense_claims",
    "goals",
    "helpdesk_tickets",
    "job_openings",
    "leave_ledger",
    "leave_requests",
    "leave_types",
    "notifications",
    "onboarding_records",
    "payroll_records",
    "payroll_runs",
    "payslips",
    "performance_reviews",
    "profiles",
    "shifts",
    "user_preferences",
  ],
};

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function authenticated(role: Role): Promise<SupabaseClient> {
  const client = createClient(env("VITE_SUPABASE_URL"), env("VITE_SUPABASE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [email, password] = vars[role];
  const result = await client.auth.signInWithPassword({
    email: env(email),
    password: env(password),
  });
  if (result.error) throw result.error;
  return client;
}

for (const role of Object.keys(vars) as Role[]) {
  test(`${role}: every module-backed table can be queried under live RLS`, async () => {
    const client = await authenticated(role);
    for (const table of readable[role]) {
      const { error } = await client.from(table).select("*").limit(1);
      expect(error, `${role} read ${table}`).toBeNull();
    }
  });
}

test("Employee: self-scoped tables never expose another employee id", async () => {
  const client = await authenticated("Employee");
  const { data: user } = await client.auth.getUser();
  const profile = await client
    .from("profiles")
    .select("employee_id")
    .eq("id", user.user!.id)
    .single();
  expect(profile.error).toBeNull();
  for (const table of [
    "attendance_records",
    "asset_requests",
    "documents",
    "expense_claims",
    "goals",
    "helpdesk_tickets",
    "leave_ledger",
    "leave_requests",
    "performance_reviews",
  ]) {
    const result = await client.from(table).select("employee_id");
    expect(result.error, table).toBeNull();
    expect(
      (result.data ?? []).every((row) => row.employee_id === profile.data!.employee_id),
      table,
    ).toBe(true);
  }
});

test("Manager: employee scope is self or direct reports only", async () => {
  const client = await authenticated("Manager");
  const { data: user } = await client.auth.getUser();
  const profile = await client
    .from("profiles")
    .select("employee_id")
    .eq("id", user.user!.id)
    .single();
  const result = await client.from("employees").select("id,manager_id");
  expect(result.error).toBeNull();
  expect(
    (result.data ?? []).every(
      (row) => row.id === profile.data!.employee_id || row.manager_id === profile.data!.employee_id,
    ),
  ).toBe(true);
});

test("Forbidden writes are rejected by live RLS", async () => {
  const employee = await authenticated("Employee");
  const manager = await authenticated("Manager");
  const employeeWrite = await employee.from("assets").insert({
    asset_code: `UAT-DENIED-${Date.now()}`,
    name: "Denied",
    category: "Other",
    condition: "new",
    status: "available",
  });
  expect(employeeWrite.error).not.toBeNull();
  const managerWrite = await manager.from("job_openings").insert({
    title: `UAT-DENIED-${Date.now()}`,
    employment_type: "full-time",
    openings: 1,
    status: "open",
  });
  expect(managerWrite.error).not.toBeNull();
});

test("Asset lifecycle RPCs persist and cleanly reconcile temporary records", async () => {
  const admin = await authenticated("Admin");
  const employee = await authenticated("Employee");
  const { data: adminUser } = await admin.auth.getUser();
  const { data: employeeUser } = await employee.auth.getUser();
  const adminProfile = await admin
    .from("profiles")
    .select("employee_id")
    .eq("id", adminUser.user!.id)
    .single();
  const adminEmployee = await admin
    .from("employees")
    .select("organization_id")
    .eq("id", adminProfile.data!.employee_id)
    .single();
  const employeeProfile = await admin
    .from("profiles")
    .select("employee_id")
    .eq("id", employeeUser.user!.id)
    .single();
  const tag = `UAT-RPC-${Date.now()}`;
  let assetId = "";
  let assignmentId = "";
  let repairId = "";
  try {
    const asset = await admin
      .from("assets")
      .insert({
        organization_id: adminEmployee.data!.organization_id,
        asset_code: tag,
        name: tag,
        category: "Laptop",
        condition: "new",
        status: "assigned",
      })
      .select("id")
      .single();
    if (asset.error) throw asset.error;
    assetId = asset.data.id;
    const assignment = await admin
      .from("asset_assignments")
      .insert({ asset_id: assetId, employee_id: employeeProfile.data!.employee_id })
      .select("id")
      .single();
    if (assignment.error) throw assignment.error;
    assignmentId = assignment.data.id;

    const repair = await employee.rpc("request_asset_repair", {
      p_asset_code: tag,
      p_issue: "UAT isolated repair",
    });
    if (repair.error) throw repair.error;
    repairId = repair.data as string;
    const repairedAsset = await admin.from("assets").select("status").eq("id", assetId).single();
    expect(repairedAsset.data?.status).toBe("in-repair");
    const persistedRepair = await admin
      .from("asset_repairs")
      .select("id,status")
      .eq("id", repairId)
      .single();
    expect(persistedRepair.data?.status).toBe("sent");

    const returned = await admin.rpc("return_asset", { p_asset_code: tag });
    expect(returned.error).toBeNull();
    expect(returned.data).toBe(assignmentId);
    const persistedAssignment = await admin
      .from("asset_assignments")
      .select("returned_at")
      .eq("id", assignmentId)
      .single();
    expect(persistedAssignment.data?.returned_at).not.toBeNull();
    const returnedAsset = await admin.from("assets").select("status").eq("id", assetId).single();
    expect(returnedAsset.data?.status).toBe("available");
  } finally {
    if (repairId) await admin.from("asset_repairs").delete().eq("id", repairId);
    if (assignmentId) await admin.from("asset_assignments").delete().eq("id", assignmentId);
    if (assetId) await admin.from("assets").delete().eq("id", assetId);
    console.log(JSON.stringify({ tag, assetId, assignmentId, repairId, cleaned: true }));
  }
});
