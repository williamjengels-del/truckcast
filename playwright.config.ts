import { defineConfig } from "@playwright/test";

// Playwright config — impersonation-blocks-mutation test suite.
// Runs against a BASE_URL (preview deployment or localhost:3000).
// Auth + target user are provided via env vars; see tests/e2e/README.md.

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "User-Agent": "vendcast-playwright-e2e" },
    trace: "retain-on-failure",
  },
  globalSetup: "./tests/e2e/global-setup.ts",
});
