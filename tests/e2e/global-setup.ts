import { chromium, FullConfig, request as pwRequest } from "@playwright/test";
import path from "node:path";

// Logs in as the admin once, persists cookies to ADMIN_STORAGE_STATE so
// every test can start from a logged-in admin context. Login goes
// through the app's /login page so SSR cookies are set exactly the way
// Supabase SSR expects them.
//
// Required env:
//   PLAYWRIGHT_BASE_URL       — preview or localhost URL
//   ADMIN_EMAIL / ADMIN_PASSWORD — admin account to sign in as
//   TARGET_USER_ID            — non-admin user id to impersonate
//
// If any of these are missing we throw here rather than at test time so
// the failure message points at the setup, not a flaky selector.

export const ADMIN_STORAGE_STATE = path.resolve(
  __dirname,
  ".auth/admin.storageState.json"
);

const REQUIRED = ["PLAYWRIGHT_BASE_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD", "TARGET_USER_ID"] as const;

export default async function globalSetup(_config: FullConfig) {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Playwright global setup: missing env vars: ${missing.join(", ")}. ` +
        `See tests/e2e/README.md.`
    );
  }

  const baseURL = process.env.PLAYWRIGHT_BASE_URL!;
  const email = process.env.ADMIN_EMAIL!;
  const password = process.env.ADMIN_PASSWORD!;

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.goto("/login", { waitUntil: "domcontentloaded" });

  // The login form is Supabase-backed; selectors are best-effort and
  // intentionally broad so small UI tweaks don't break setup.
  const emailField = page.getByLabel(/email/i).first();
  const passwordField = page.getByLabel(/password/i).first();
  await emailField.fill(email);
  await passwordField.fill(password);

  const submit = page
    .getByRole("button", { name: /sign in|log in|continue/i })
    .first();
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }),
    submit.click(),
  ]);

  // Sanity check: we must be authenticated — probe an authed JSON route.
  const probe = await pwRequest.newContext({
    baseURL,
    storageState: await context.storageState(),
    ignoreHTTPSErrors: true,
  });
  const res = await probe.get("/api/dashboard/profile");
  if (res.status() === 401) {
    throw new Error(
      "Playwright global setup: login appeared to succeed but " +
        "/api/dashboard/profile returned 401. Check ADMIN_EMAIL/PASSWORD."
    );
  }

  await context.storageState({ path: ADMIN_STORAGE_STATE });
  await probe.dispose();
  await browser.close();
}
