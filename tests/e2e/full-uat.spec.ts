import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Full read-only UAT crawl as one signed-in user (normally the Super Admin).
 *
 * Visits every page and every in-page tab, opens each "New / Add" dialog and
 * cancels it, and records anything that goes wrong: error screens, console
 * errors, uncaught exceptions and failed Supabase requests. Nothing is saved.
 *
 * Run:
 *   $env:E2E_EMAIL = "..."; $env:E2E_PASSWORD = "..."
 *   npx playwright test tests/e2e/full-uat.spec.ts
 *
 * Output: a JSON findings file and one screenshot per page/tab under
 * $E2E_OUT (default: <tmp>/jeevijay-hrms-uat).
 */

const OUT = process.env["E2E_OUT"] ?? path.join(os.tmpdir(), "jeevijay-hrms-uat");

const PAGES = [
  "/",
  "/org-overview",
  "/announcements",
  "/notifications",
  "/employees",
  "/departments",
  "/designations",
  "/onboarding",
  "/recruitment",
  "/attendance",
  "/work",
  "/shifts",
  "/leave",
  "/payroll",
  "/expenses",
  "/goals",
  "/performance",
  "/kra",
  "/insights",
  "/projects",
  "/assets",
  "/documents",
  "/helpdesk",
  "/crm",
  "/roles",
  "/reports",
  "/audit",
  "/settings",
];

/** Text that means a page or section failed to render. */
const ERROR_TEXT = /Something went wrong|This page didn't load|Could not find the function|schema cache/i;

interface Finding {
  page: string;
  tab?: string;
  kind: "error-screen" | "console" | "exception" | "request" | "redirect" | "dialog";
  detail: string;
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running this test.`);
  return value;
}

function slug(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(15 * 60_000);

test("every page and tab renders without errors", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const findings: Finding[] = [];
  const visited: { page: string; tabs: string[]; finalUrl: string }[] = [];
  let current = { page: "sign-in", tab: undefined as string | undefined };

  const note = (kind: Finding["kind"], detail: string) => {
    const entry: Finding = { page: current.page, kind, detail: detail.slice(0, 500) };
    if (current.tab) entry.tab = current.tab;
    findings.push(entry);
  };

  page.on("console", (message) => {
    if (message.type() === "error") note("console", message.text());
  });
  page.on("pageerror", (error) => note("exception", error.message));
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes(".supabase.co") || response.status() < 400) return;
    let body = "";
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      // body unavailable (e.g. navigation aborted)
    }
    const shortUrl = url.replace(/^https:\/\/[^/]+/, "").split("?")[0];
    note("request", `${response.request().method()} ${shortUrl} → ${response.status()} ${body}`);
  });

  // ---- sign in
  await page.goto("/sign-in");
  await settle(page);
  await page.getByLabel("Work email", { exact: true }).fill(env("E2E_EMAIL"));
  await page.getByLabel("Password", { exact: true }).fill(env("E2E_PASSWORD"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 30_000 });
  await settle(page);

  const checkScreen = async () => {
    const text = await page.locator("main").innerText().catch(() => "");
    const match = text.match(ERROR_TEXT);
    if (match) {
      const line = text.split("\n").find((l) => ERROR_TEXT.test(l)) ?? match[0];
      const index = text.indexOf(line);
      note("error-screen", text.slice(index, index + 300).replace(/\s+/g, " "));
    }
  };

  const shoot = async (name: string) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  const tryDialogs = async () => {
    const buttons = page.getByRole("button", { name: /^(New |Add |Create |Upload |Log )/ });
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 3); i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible()) || (await button.isDisabled())) continue;
      const label = (await button.innerText()).trim();
      await button.click();
      const dialog = page.getByRole("dialog");
      try {
        await dialog.first().waitFor({ state: "visible", timeout: 3000 });
      } catch {
        continue; // some buttons navigate or toggle instead of opening a dialog
      }
      const fields = await dialog.locator("input, textarea, select, [role=combobox]").count();
      if (fields === 0) note("dialog", `"${label}" opened a dialog with no form fields`);
      const text = await dialog.first().innerText();
      if (ERROR_TEXT.test(text)) note("dialog", `"${label}" dialog shows: ${text.slice(0, 200)}`);
      const cancel = dialog.getByRole("button", { name: /^(Cancel|Close)$/ });
      if (await cancel.count()) await cancel.first().click();
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  };

  const visitTabs = async (base: string) => {
    const tabs = page.getByRole("tab");
    const names: string[] = [];
    const count = await tabs.count();
    for (let i = 0; i < count; i += 1) {
      const tab = tabs.nth(i);
      if (!(await tab.isVisible())) continue;
      const name = (await tab.innerText()).trim();
      names.push(name);
      current.tab = name;
      await tab.click();
      await settle(page);
      await checkScreen();
      await tryDialogs();
      await shoot(`${base}__${slug(name)}`);
    }
    current.tab = undefined;
    return names;
  };

  const visit = async (route: string) => {
    current = { page: route, tab: undefined };
    await page.goto(route);
    await settle(page);
    const finalUrl = new URL(page.url()).pathname;
    if (finalUrl !== route && !(route === "/" && finalUrl === "/")) {
      note("redirect", `${route} redirected to ${finalUrl}`);
    }
    await checkScreen();
    for (const input of await page.locator('input[placeholder*="Search" i]').all()) {
      if (await input.isVisible()) {
        await input.fill("__UAT_NO_MATCH__");
        await page.waitForTimeout(300);
        await input.fill("");
      }
    }
    await tryDialogs();
    await shoot(slug(route));
    const tabs = await visitTabs(slug(route));
    visited.push({ page: route, tabs, finalUrl });
  };

  for (const route of PAGES) await visit(route);

  // ---- detail pages: first employee profile and first project
  await page.goto("/employees");
  await settle(page);
  const profileLink = page.locator('a[href^="/employees/"]').first();
  if (await profileLink.count()) {
    const href = await profileLink.getAttribute("href");
    if (href) await visit(href);
  } else {
    const firstRow = page.locator("tbody tr").first();
    if (await firstRow.count()) {
      await firstRow.click();
      await settle(page);
      const href = new URL(page.url()).pathname;
      if (href.startsWith("/employees/")) await visit(href);
    }
  }
  await page.goto("/projects");
  await settle(page);
  const projectLink = page.locator('a[href^="/projects/"]').first();
  if (await projectLink.count()) {
    const href = await projectLink.getAttribute("href");
    if (href) await visit(href);
  }

  // ---- phone width: no sideways scroll on key pages
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/org-overview", "/employees", "/work", "/kra", "/crm"]) {
    current = { page: `${route} (390px)`, tab: undefined };
    await page.goto(route);
    await settle(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 1) note("error-screen", `horizontal scroll of ${overflow}px at 390px width`);
    await shoot(`mobile-${slug(route)}`);
  }

  fs.writeFileSync(
    path.join(OUT, "findings.json"),
    JSON.stringify({ visited, findings }, null, 2),
  );
  console.log(`UAT: ${visited.length} pages, ${findings.length} findings → ${OUT}`);
});
