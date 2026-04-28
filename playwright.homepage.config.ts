import { defineConfig, devices } from "@playwright/test";

// Public-marketing-surface config — no auth, no globalSetup.
// The main playwright.config.ts gates on admin credentials for the
// impersonation suites. The marketing specs exercise only public
// pages (homepage, /pricing), so they run against a local dev server
// with no credentials.
//
// Usage:
//   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
//     npx playwright test --config=playwright.homepage.config.ts
//
// Filename kept as `playwright.homepage.config.ts` (not renamed to
// "marketing") so existing tooling and runbooks don't break — the
// testMatch regex below scopes which specs run.

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  // Marketing specs: homepage + /pricing. Add new public-page specs
  // to this regex when they land. Auth-gated specs stay on the main
  // playwright.config.ts.
  testMatch: /(homepage-rebuild|pricing-page)\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "User-Agent": "vendcast-playwright-homepage" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } },
    },
  ],
});
