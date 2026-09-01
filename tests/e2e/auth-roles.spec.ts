import { expect, test, type Page } from "@playwright/test";

type RoleCase = {
  role: "Admin" | "HR" | "Manager" | "Employee";
  emailVariable: string;
  passwordVariable: string;
  allowedPath: string;
  forbiddenPath?: string;
  expectedNavigation: string[];
  hiddenNavigation: string[];
};

const cases: RoleCase[] = [
  {
    role: "Admin",
    emailVariable: "E2E_ADMIN_EMAIL",
    passwordVariable: "E2E_ADMIN_PASSWORD",
    allowedPath: "/audit",
    expectedNavigation: ["Employees", "Payroll", "Recruitment", "Activity History", "Settings"],
    hiddenNavigation: [],
  },
  {
    role: "HR",
    emailVariable: "E2E_HR_EMAIL",
    passwordVariable: "E2E_HR_PASSWORD",
    allowedPath: "/audit",
    expectedNavigation: ["Employees", "Payroll", "Recruitment", "Activity History", "Settings"],
    hiddenNavigation: [],
  },
  {
    role: "Manager",
    emailVariable: "E2E_MANAGER_EMAIL",
    passwordVariable: "E2E_MANAGER_PASSWORD",
    allowedPath: "/employees",
    forbiddenPath: "/payroll",
    expectedNavigation: ["My Team", "Attendance", "Goals", "Assets", "Settings"],
    hiddenNavigation: ["Payroll", "Recruitment", "Activity History"],
  },
  {
    role: "Employee",
    emailVariable: "E2E_EMPLOYEE_EMAIL",
    passwordVariable: "E2E_EMPLOYEE_PASSWORD",
    allowedPath: "/attendance",
    forbiddenPath: "/employees",
    expectedNavigation: ["My Attendance", "My Payroll", "My Goals", "My Assets"],
    hiddenNavigation: ["Employees", "Recruitment", "Activity History", "Settings"],
  },
];

function credential(variable: string): string {
  const value = process.env[variable];
  if (!value) throw new Error(`Missing required ${variable}`);
  return value;
}

async function signIn(page: Page, roleCase: RoleCase) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email", { exact: true }).fill(credential(roleCase.emailVariable));
  await page.getByLabel("Password", { exact: true }).fill(credential(roleCase.passwordVariable));
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

for (const roleCase of cases) {
  test(`${roleCase.role}: authenticated session, guards, data and one-click logout`, async ({
    page,
  }) => {
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

    if (roleCase.role === "Admin") {
      await expect(page.getByText("Password reset requests", { exact: true })).toBeVisible();
    }
    if (roleCase.role === "HR") {
      await expect(page.getByText("Password reset requests", { exact: true })).toHaveCount(0);
    }

    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Profile menu", exact: true })).toBeVisible();

    await page.goto(roleCase.allowedPath);
    await expect(page).toHaveURL(new RegExp(`${roleCase.allowedPath}$`));
    await expect(page.getByText("This page didn't load", { exact: true })).toHaveCount(0);

    if (roleCase.forbiddenPath) {
      await page.goto(roleCase.forbiddenPath);
      await expect(page).toHaveURL(/\/unauthorized$/);
      await expect(page.getByText(/does not have permission/)).toBeVisible();
      await page.goto("/");
    }

    await signOutOnce(page);

    await page.goto(roleCase.allowedPath);
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);

    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);

    await signIn(page, roleCase);
    await signOutOnce(page);

    expect(consoleErrorCount).toBe(0);
    expect(pageErrorCount).toBe(0);
  });
}
