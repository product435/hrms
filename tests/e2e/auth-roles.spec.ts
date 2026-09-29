import { expect, test, type Page } from "@playwright/test";

/**
 * Stored roles are admin, hr, dept_head, team_lead, and employee.
 * The UI labels admin as Super Admin. The former manager account
 * (E2E_MANAGER_EMAIL) is a team lead. Department-head login runs only
 * when E2E_DEPT_HEAD_EMAIL and E2E_DEPT_HEAD_PASSWORD are set.
 *
 * Route guard (src/services/authService.ts ROUTE_ROLES):
 * - /roles is admin only
 * - /work and /kra are all five roles
 * - /complete-profile and /profile-status are all five roles; pending and
 *   rejected accounts are further limited in src/lib/auth-guard.ts
 * - department heads keep former manager routes and also see Departments
 * - employees cannot open admin/HR-only pages
 */

type UiRole = "Super Admin" | "HR" | "Department Head" | "Team Lead" | "Employee";

type RoleCase = {
  role: UiRole;
  emailVariable: string;
  passwordVariable: string;
  optionalAccount?: boolean;
  allowedPaths: string[];
  forbiddenPaths: string[];
  expectedNavigation: string[];
  hiddenNavigation: string[];
};

const cases: RoleCase[] = [
  {
    role: "Super Admin",
    emailVariable: "E2E_ADMIN_EMAIL",
    passwordVariable: "E2E_ADMIN_PASSWORD",
    allowedPaths: ["/audit", "/roles", "/work", "/kra", "/complete-profile", "/profile-status"],
    forbiddenPaths: [],
    expectedNavigation: [
      "Employees",
      "Payroll",
      "Recruitment",
      "Activity History",
      "Settings",
      "Role management",
      "Work",
      "KRA & KPI",
    ],
    hiddenNavigation: [],
  },
  {
    role: "HR",
    emailVariable: "E2E_HR_EMAIL",
    passwordVariable: "E2E_HR_PASSWORD",
    allowedPaths: ["/audit", "/work", "/kra", "/complete-profile", "/profile-status"],
    forbiddenPaths: ["/roles"],
    expectedNavigation: [
      "Employees",
      "Payroll",
      "Recruitment",
      "Activity History",
      "Settings",
      "Work",
      "KRA & KPI",
    ],
    hiddenNavigation: ["Role management"],
  },
  {
    role: "Department Head",
    emailVariable: "E2E_DEPT_HEAD_EMAIL",
    passwordVariable: "E2E_DEPT_HEAD_PASSWORD",
    optionalAccount: true,
    allowedPaths: [
      "/employees",
      "/departments",
      "/work",
      "/kra",
      "/complete-profile",
      "/profile-status",
    ],
    forbiddenPaths: ["/roles", "/payroll", "/recruitment", "/audit"],
    expectedNavigation: [
      "My Department",
      "Departments",
      "Attendance",
      "Goals",
      "Assets",
      "Settings",
      "Work",
      "KRA & KPI",
    ],
    hiddenNavigation: [
      "Payroll",
      "Recruitment",
      "Activity History",
      "Role management",
      "Designations",
    ],
  },
  {
    role: "Team Lead",
    emailVariable: "E2E_MANAGER_EMAIL",
    passwordVariable: "E2E_MANAGER_PASSWORD",
    allowedPaths: ["/employees", "/work", "/kra", "/complete-profile", "/profile-status"],
    forbiddenPaths: ["/payroll", "/roles", "/recruitment", "/audit"],
    expectedNavigation: [
      "My Team",
      "Attendance",
      "Goals",
      "Assets",
      "Settings",
      "Work",
      "KRA & KPI",
    ],
    hiddenNavigation: [
      "Payroll",
      "Recruitment",
      "Activity History",
      "Role management",
      "Departments",
    ],
  },
  {
    role: "Employee",
    emailVariable: "E2E_EMPLOYEE_EMAIL",
    passwordVariable: "E2E_EMPLOYEE_PASSWORD",
    allowedPaths: ["/attendance", "/work", "/kra", "/complete-profile", "/profile-status"],
    forbiddenPaths: ["/employees", "/roles", "/recruitment", "/audit", "/onboarding", "/settings"],
    expectedNavigation: [
      "My Attendance",
      "My Payroll",
      "My Goals",
      "My Assets",
      "Work",
      "My KRA & KPI",
    ],
    hiddenNavigation: [
      "Employees",
      "Recruitment",
      "Activity History",
      "Settings",
      "Role management",
    ],
  },
];

function credential(variable: string): string | undefined {
  const value = process.env[variable];
  return value && value.length > 0 ? value : undefined;
}

function requireCredential(variable: string): string {
  const value = credential(variable);
  if (!value) throw new Error(`Missing required ${variable}`);
  return value;
}

async function signIn(page: Page, roleCase: RoleCase) {
  await page.goto("/sign-in");
  await page
    .getByLabel("Work email", { exact: true })
    .fill(requireCredential(roleCase.emailVariable));
  await page
    .getByLabel("Password", { exact: true })
    .fill(requireCredential(roleCase.passwordVariable));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Profile menu", exact: true })).toBeVisible();
  await expect(page.getByText(roleCase.role, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("This page didn't load", { exact: true })).toHaveCount(0);
}

async function signOutOnce(page: Page) {
  // A direct SSR navigation can expose the rendered trigger before React has
  // attached Radix's client event handlers. Wait for hydration/network idle
  // so this exercises the real one-click menu interaction.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Profile menu", exact: true }).click();
  const signOutRow = page.getByRole("menu").getByText("Sign out", { exact: true });
  await expect(signOutRow).toBeEnabled();
  const started = Date.now();
  await signOutRow.click();
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  expect(Date.now() - started).toBeLessThan(10_000);

  const authCookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes("auth-token"),
  );
  expect(authCookies).toHaveLength(0);
}

test("route matrix covers all five roles", () => {
  const byRole = new Map(cases.map((roleCase) => [roleCase.role, roleCase]));
  expect([...byRole.keys()]).toEqual([
    "Super Admin",
    "HR",
    "Department Head",
    "Team Lead",
    "Employee",
  ]);

  for (const roleCase of cases) {
    expect(roleCase.allowedPaths).toEqual(
      expect.arrayContaining(["/work", "/kra", "/complete-profile", "/profile-status"]),
    );
    if (roleCase.role === "Super Admin") {
      expect(roleCase.allowedPaths).toContain("/roles");
      expect(roleCase.forbiddenPaths).not.toContain("/roles");
    } else {
      expect(roleCase.forbiddenPaths).toContain("/roles");
      expect(roleCase.allowedPaths).not.toContain("/roles");
    }
  }

  const departmentHead = byRole.get("Department Head");
  const teamLead = byRole.get("Team Lead");
  expect(departmentHead?.allowedPaths).toContain("/departments");
  expect(departmentHead?.expectedNavigation).toEqual(
    expect.arrayContaining(["Departments", "My Department"]),
  );
  expect(teamLead?.emailVariable).toBe("E2E_MANAGER_EMAIL");
  expect(teamLead?.hiddenNavigation).toContain("Departments");
  expect(teamLead?.forbiddenPaths).toEqual(
    expect.arrayContaining(["/payroll", "/recruitment", "/audit"]),
  );
  expect(byRole.get("Employee")?.forbiddenPaths).toEqual(
    expect.arrayContaining(["/employees", "/roles", "/recruitment", "/audit", "/onboarding"]),
  );
});

for (const roleCase of cases) {
  test(`${roleCase.role}: authenticated session, guards, data and one-click logout`, async ({
    page,
  }) => {
    test.skip(
      roleCase.optionalAccount === true &&
        (!credential(roleCase.emailVariable) || !credential(roleCase.passwordVariable)),
      "No department-head e2e account (E2E_DEPT_HEAD_EMAIL / E2E_DEPT_HEAD_PASSWORD). The route matrix above still records department visibility.",
    );

    let consoleErrorCount = 0;
    let pageErrorCount = 0;
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrorCount += 1;
    });
    page.on("pageerror", () => {
      pageErrorCount += 1;
    });

    await signIn(page, roleCase);

    if (roleCase.role === "Employee") {
      await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "People operations overview" })).toBeVisible();
    }

    for (const label of roleCase.expectedNavigation) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    for (const label of roleCase.hiddenNavigation) {
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }

    if (roleCase.role === "Super Admin") {
      await expect(page.getByText("Password reset requests", { exact: true })).toBeVisible();
    }
    if (roleCase.role === "HR") {
      await expect(page.getByText("Password reset requests", { exact: true })).toHaveCount(0);
    }

    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Profile menu", exact: true })).toBeVisible();

    for (const path of roleCase.allowedPaths) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByText("This page didn't load", { exact: true })).toHaveCount(0);
    }

    for (const path of roleCase.forbiddenPaths) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/unauthorized$/);
      await expect(page.getByText(/does not have permission/)).toBeVisible();
      await page.goto("/");
    }

    await signOutOnce(page);

    await page.goto(roleCase.allowedPaths[0] ?? "/");
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);

    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);

    await signIn(page, roleCase);
    await signOutOnce(page);

    expect(consoleErrorCount).toBe(0);
    expect(pageErrorCount).toBe(0);
  });
}
