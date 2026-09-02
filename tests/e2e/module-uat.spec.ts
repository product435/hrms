import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Role = "Admin" | "HR" | "Manager" | "Employee";

const credentials: Record<Role, [string, string]> = {
  Admin: ["E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"],
  HR: ["E2E_HR_EMAIL", "E2E_HR_PASSWORD"],
  Manager: ["E2E_MANAGER_EMAIL", "E2E_MANAGER_PASSWORD"],
  Employee: ["E2E_EMPLOYEE_EMAIL", "E2E_EMPLOYEE_PASSWORD"],
};

const allowed: Record<Role, string[]> = {
  Admin: [
    "/",
    "/announcements",
    "/notifications",
    "/employees",
    "/departments",
    "/designations",
    "/onboarding",
    "/recruitment",
    "/attendance",
    "/shifts",
    "/leave",
    "/payroll",
    "/expenses",
    "/goals",
    "/performance",
    "/assets",
    "/documents",
    "/helpdesk",
    "/reports",
    "/audit",
    "/settings",
  ],
  HR: [
    "/",
    "/announcements",
    "/notifications",
    "/employees",
    "/departments",
    "/designations",
    "/onboarding",
    "/recruitment",
    "/attendance",
    "/shifts",
    "/leave",
    "/payroll",
    "/expenses",
    "/goals",
    "/performance",
    "/assets",
    "/documents",
    "/helpdesk",
    "/reports",
    "/audit",
    "/settings",
  ],
  Manager: [
    "/",
    "/announcements",
    "/notifications",
    "/employees",
    "/departments",
    "/designations",
    "/attendance",
    "/shifts",
    "/leave",
    "/expenses",
    "/goals",
    "/performance",
    "/assets",
    "/documents",
    "/helpdesk",
    "/reports",
    "/settings",
  ],
  Employee: [
    "/",
    "/announcements",
    "/notifications",
    "/attendance",
    "/leave",
    "/payroll",
    "/expenses",
    "/goals",
    "/performance",
    "/assets",
    "/documents",
    "/helpdesk",
  ],
};

const forbidden: Record<Role, string[]> = {
  Admin: [],
  HR: [],
  Manager: ["/onboarding", "/recruitment", "/payroll", "/audit"],
  Employee: [
    "/employees",
    "/departments",
    "/designations",
    "/onboarding",
    "/recruitment",
    "/shifts",
    "/reports",
    "/audit",
    "/settings",
  ],
};

function secret(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function login(page: Page, role: Role) {
  await page.goto("/sign-in");
  const [email, password] = credentials[role];
  await page.getByLabel("Work email", { exact: true }).fill(secret(email));
  await page.getByLabel("Password", { exact: true }).fill(secret(password));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible();
}

async function clientFor(role: Role): Promise<SupabaseClient> {
  const client = createClient(secret("VITE_SUPABASE_URL"), secret("VITE_SUPABASE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [email, password] = credentials[role];
  const { error } = await client.auth.signInWithPassword({
    email: secret(email),
    password: secret(password),
  });
  if (error) throw error;
  return client;
}

for (const role of Object.keys(credentials) as Role[]) {
  test(`${role}: every allowed module loads and interactive controls render`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await login(page, role);
    for (const path of allowed[role]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : `${path}$`}`));
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText("This page didn't load", { exact: true })).toHaveCount(0);
      await expect(page.locator("main h1").first()).toBeVisible();

      for (const input of await page.locator('input[placeholder*="Search" i]').all()) {
        if (await input.isVisible()) {
          await input.fill("__UAT_NO_MATCH__");
          await input.fill("");
        }
      }

      const newButtons = page.getByRole("button", { name: /^(New |Add |Create |Upload )/ });
      if ((await newButtons.count()) > 0 && (await newButtons.first().isVisible())) {
        await newButtons.first().click();
        const dialog = page.getByRole("dialog");
        if (await dialog.isVisible()) {
          await expect(dialog.locator("input, textarea, select").first()).toBeVisible();
          const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
          if (await cancel.count()) await cancel.click();
          else await page.keyboard.press("Escape");
        }
      }
    }

    for (const path of forbidden[role]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/unauthorized$/);
      await expect(page.getByText(/does not have permission/)).toBeVisible();
    }

    expect(pageErrors, `page errors for ${role}`).toEqual([]);
    expect(consoleErrors, `console errors for ${role}`).toEqual([]);
  });
}

test("Employee: assigned-asset repair action reaches its persisted workflow", async ({ page }) => {
  await login(page, "Employee");
  const admin = await clientFor("Admin");
  const employee = await clientFor("Employee");
  const tag = `UAT-ASSET-${Date.now()}`;
  let assetId = "";
  let assignmentId = "";
  let repairId = "";
  try {
    const { data: adminUser } = await admin.auth.getUser();
    const { data: employeeUser } = await employee.auth.getUser();
    const { data: adminProfile, error: adminProfileError } = await admin
      .from("profiles")
      .select("employee_id")
      .eq("id", adminUser.user!.id)
      .single();
    if (adminProfileError) throw adminProfileError;
    const { data: adminEmployee, error: adminEmployeeError } = await admin
      .from("employees")
      .select("organization_id")
      .eq("id", adminProfile.employee_id)
      .single();
    if (adminEmployeeError) throw adminEmployeeError;
    const { data: employeeProfile, error: employeeProfileError } = await admin
      .from("profiles")
      .select("employee_id")
      .eq("id", employeeUser.user!.id)
      .single();
    if (employeeProfileError) throw employeeProfileError;
    const { data: asset, error: assetError } = await admin
      .from("assets")
      .insert({
        organization_id: adminEmployee.organization_id,
        asset_code: tag,
        name: tag,
        category: "Laptop",
        condition: "new",
        status: "assigned",
      })
      .select("id")
      .single();
    if (assetError) throw assetError;
    assetId = asset.id;
    const { data: assignment, error: assignmentError } = await admin
      .from("asset_assignments")
      .insert({ asset_id: assetId, employee_id: employeeProfile.employee_id })
      .select("id")
      .single();
    if (assignmentError) throw assignmentError;
    assignmentId = assignment.id;

    await page.getByRole("link", { name: "My Assets", exact: true }).click();
    await expect(page).toHaveURL(/\/assets$/);
    const row = page.getByRole("row").filter({ hasText: tag });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Repair", exact: true }).click();
    await expect(page.getByText("Repair request logged", { exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: tag })).toContainText(/In Repair/i);

    const repair = await admin.from("asset_repairs").select("id").eq("asset_id", assetId).single();
    if (repair.error) throw repair.error;
    repairId = repair.data.id;
  } finally {
    if (!repairId && assetId) {
      const repairs = await admin.from("asset_repairs").select("id").eq("asset_id", assetId);
      repairId = repairs.data?.[0]?.id ?? "";
    }
    if (repairId) await admin.from("asset_repairs").delete().eq("id", repairId);
    if (assignmentId) await admin.from("asset_assignments").delete().eq("id", assignmentId);
    if (assetId) await admin.from("assets").delete().eq("id", assetId);
    console.log(JSON.stringify({ tag, assetId, assignmentId, repairId, cleaned: true }));
  }
});

test("Admin: returning a temporary asset closes its assignment", async ({ page }) => {
  await login(page, "Admin");
  const admin = await clientFor("Admin");
  const employee = await clientFor("Employee");
  const tag = `UAT-RETURN-${Date.now()}`;
  let assetId = "";
  let assignmentId = "";
  try {
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

    await page.getByRole("link", { name: "Assets", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: tag });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Return", exact: true }).click();
    await expect(page.getByText("Asset marked as returned", { exact: true })).toBeVisible();
    await expect(row).toContainText("Available");
    const persisted = await admin
      .from("asset_assignments")
      .select("returned_at,returned_by")
      .eq("id", assignmentId)
      .single();
    expect(persisted.data?.returned_at).not.toBeNull();
    expect(persisted.data?.returned_by).toBe(adminUser.user!.id);
  } finally {
    if (assignmentId) await admin.from("asset_assignments").delete().eq("id", assignmentId);
    if (assetId) await admin.from("assets").delete().eq("id", assetId);
    console.log(JSON.stringify({ tag, assetId, assignmentId, cleaned: true }));
  }
});

test("Employee: safe self-service creates persist across modules", async ({ page }) => {
  await login(page, "Employee");
  const admin = await clientFor("Admin");
  const tag = `UAT-SELF-${Date.now()}`;
  const ids = { expense: "", ticket: "", goal: "", assetRequest: "" };
  try {
    await page.getByRole("link", { name: "My Expenses", exact: true }).click();
    await page.getByRole("button", { name: "New claim", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.locator('input[type="number"]').fill("123");
    await dialog.locator('input[type="date"]').fill("2026-09-01");
    await dialog.locator("textarea").fill(tag);
    await dialog.getByRole("button", { name: "Submit claim", exact: true }).click();
    await expect(page.getByText("Expense claim submitted", { exact: true })).toBeVisible();
    const expense = await admin
      .from("expense_claims")
      .select("id,amount,status")
      .eq("description", tag)
      .single();
    if (expense.error) throw expense.error;
    ids.expense = expense.data.id;
    expect(Number(expense.data.amount)).toBe(123);
    expect(expense.data.status).toBe("pending");

    await page.getByRole("link", { name: "My Requests", exact: true }).click();
    await page.getByRole("button", { name: "New request", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator("input").fill(tag);
    await dialog.locator("textarea").fill(`${tag} description`);
    await dialog.getByRole("button", { name: "Submit request", exact: true }).click();
    await expect(page.getByText("Request submitted", { exact: true })).toBeVisible();
    const ticket = await admin
      .from("helpdesk_tickets")
      .select("id,status,description")
      .eq("subject", tag)
      .single();
    if (ticket.error) throw ticket.error;
    ids.ticket = ticket.data.id;
    expect(ticket.data.status).toBe("open");
    expect(ticket.data.description).toBe(`${tag} description`);

    await page.getByRole("link", { name: "My Goals", exact: true }).click();
    await page.getByRole("button", { name: "Add goal", exact: true }).click();
    dialog = page.getByRole("dialog");
    const goalInputs = dialog.locator("input");
    await goalInputs.nth(0).fill(tag);
    await dialog.locator("textarea").fill(`${tag} description`);
    await goalInputs.nth(1).fill("Complete UAT");
    await goalInputs.nth(2).fill("2026-09-30");
    await goalInputs.nth(3).fill("10");
    await dialog.getByRole("button", { name: "Add goal", exact: true }).click();
    await expect(page.getByText("Goal added", { exact: true })).toBeVisible();
    const goal = await admin
      .from("goals")
      .select("id,target,due_date,weight,status")
      .eq("title", tag)
      .single();
    if (goal.error) throw goal.error;
    ids.goal = goal.data.id;
    expect(goal.data.target).toBe("Complete UAT");
    expect(goal.data.due_date).toBe("2026-09-30");
    expect(Number(goal.data.weight)).toBe(10);

    await page.getByRole("link", { name: "My Assets", exact: true }).click();
    await page.getByRole("button", { name: "Request asset", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill(tag);
    await dialog.getByRole("button", { name: "Submit request", exact: true }).click();
    await expect(page.getByText("Asset request submitted", { exact: true })).toBeVisible();
    const assetRequest = await admin
      .from("asset_requests")
      .select("id,status,details")
      .eq("details", tag)
      .single();
    if (assetRequest.error) throw assetRequest.error;
    ids.assetRequest = assetRequest.data.id;
    expect(assetRequest.data.status).toBe("pending");
  } finally {
    if (ids.assetRequest) await admin.from("asset_requests").delete().eq("id", ids.assetRequest);
    if (ids.goal) await admin.from("goals").delete().eq("id", ids.goal);
    if (ids.ticket) await admin.from("helpdesk_tickets").delete().eq("id", ids.ticket);
    if (ids.expense) await admin.from("expense_claims").delete().eq("id", ids.expense);
    console.log(JSON.stringify({ tag, ids, cleaned: true }));
  }
});

test("Admin: safe catalogue and workplace creates persist", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "Admin");
  const admin = await clientFor("Admin");
  const tag = `UAT-ADMIN-${Date.now()}`;
  const ids = {
    department: "",
    designation: "",
    announcement: "",
    shift: "",
    asset: "",
    opening: "",
  };
  try {
    await page.getByRole("link", { name: "Departments", exact: true }).click();
    await page.getByRole("button", { name: "New department", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.locator("input").nth(0).fill(tag);
    await dialog.locator("input").nth(1).fill(tag.slice(-18));
    await dialog.getByRole("button", { name: "Create department", exact: true }).click();
    await expect(page.getByText("Department created", { exact: true })).toBeVisible();
    const department = await admin.from("departments").select("id,code").eq("name", tag).single();
    if (department.error) throw department.error;
    ids.department = department.data.id;

    await page.getByRole("link", { name: "Designations", exact: true }).click();
    await page.getByRole("button", { name: "New designation", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator("input").fill(tag);
    await dialog.getByRole("button", { name: "Create designation", exact: true }).click();
    await expect(page.getByText("Designation created", { exact: true })).toBeVisible();
    const designation = await admin.from("designations").select("id").eq("name", tag).single();
    if (designation.error) throw designation.error;
    ids.designation = designation.data.id;

    await page.getByRole("link", { name: "Announcements", exact: true }).click();
    await page.getByRole("button", { name: "New announcement", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator("input").fill(tag);
    await dialog.locator("textarea").fill(`${tag} content`);
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Announcement published", { exact: true })).toBeVisible();
    const announcement = await admin
      .from("announcements")
      .select("id,content")
      .eq("title", tag)
      .single();
    if (announcement.error) throw announcement.error;
    ids.announcement = announcement.data.id;
    expect(announcement.data.content).toBe(`${tag} content`);

    await page.getByRole("link", { name: "Shifts", exact: true }).click();
    await page.getByRole("button", { name: "New shift", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator("input").first().fill(tag);
    await dialog.getByRole("button", { name: "Create shift", exact: true }).click();
    await expect(page.getByText("Shift created", { exact: true })).toBeVisible();
    const shift = await admin
      .from("shifts")
      .select("id,start_time,end_time")
      .eq("name", tag)
      .single();
    if (shift.error) throw shift.error;
    ids.shift = shift.data.id;

    await page.getByRole("link", { name: "Assets", exact: true }).click();
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    dialog = page.getByRole("dialog");
    const assetInputs = dialog.locator("input");
    await assetInputs.nth(0).fill(tag);
    await assetInputs.nth(1).fill(tag);
    await assetInputs.nth(2).fill(`${tag}-SERIAL`);
    await assetInputs.nth(3).fill("UAT Room");
    await assetInputs.nth(4).fill("456");
    await dialog.getByRole("button", { name: "Add asset", exact: true }).click();
    await expect(page.getByText("Asset added", { exact: true })).toBeVisible();
    const asset = await admin
      .from("assets")
      .select("id,serial_number,location,purchase_cost")
      .eq("asset_code", tag)
      .single();
    if (asset.error) throw asset.error;
    ids.asset = asset.data.id;
    expect(asset.data.location).toBe("UAT Room");
    expect(Number(asset.data.purchase_cost)).toBe(456);

    await page.getByRole("link", { name: "Recruitment", exact: true }).click();
    await page.getByRole("button", { name: "New requisition", exact: true }).click();
    dialog = page.getByRole("dialog");
    const openingInputs = dialog.locator("input");
    await openingInputs.nth(0).fill(tag);
    await openingInputs.nth(1).fill("Remote");
    await openingInputs.nth(2).fill("2");
    await dialog.getByRole("button", { name: "Create requisition", exact: true }).click();
    await expect(page.getByText("Requisition created", { exact: true })).toBeVisible();
    const opening = await admin
      .from("job_openings")
      .select("id,location,openings,status")
      .eq("title", tag)
      .single();
    if (opening.error) throw opening.error;
    ids.opening = opening.data.id;
    expect(opening.data.location).toBe("Remote");
    expect(opening.data.openings).toBe(2);
  } finally {
    if (ids.opening) await admin.from("job_openings").delete().eq("id", ids.opening);
    if (ids.asset) await admin.from("assets").delete().eq("id", ids.asset);
    if (ids.shift) await admin.from("shifts").delete().eq("id", ids.shift);
    if (ids.announcement) await admin.from("announcements").delete().eq("id", ids.announcement);
    if (ids.designation) await admin.from("designations").delete().eq("id", ids.designation);
    if (ids.department) await admin.from("departments").delete().eq("id", ids.department);
    console.log(JSON.stringify({ tag, ids, cleaned: true }));
  }
});
