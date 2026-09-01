import { defineConfig } from "@playwright/test";
import path from "node:path";
import os from "node:os";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list", { printSteps: false }]],
  outputDir: path.join(os.tmpdir(), "jeevijay-hrms-playwright-results"),
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:4176",
    channel: "chrome",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
