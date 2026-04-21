import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./global-setup";

// UI-level smoke test: admin starts impersonation, navigates to the
// integrations tab, and clicks "POS Sync". The resulting network call
// should be a 403 with x-impersonation-blocked: 1. This mirrors the
// user-facing path the bug was originally noticed on.
//
// Selectors are intentionally loose (role + name regex) so small UI
// text tweaks don't break the test. If the integrations tab or the POS
// sync button gets a data-testid later, tighten these.

const TARGET_USER_ID = process.env.TARGET_USER_ID!;

test.use({ storageState: ADMIN_STORAGE_STATE });

test("clicking POS Sync under impersonation yields a 403 from middleware", async ({ page }) => {
  // Start impersonation via the same API the admin UI uses.
  const startRes = await page.request.post("/api/admin/impersonate/start", {
    data: { userId: TARGET_USER_ID },
  });
  expect(startRes.ok()).toBe(true);

  await page.goto("/dashboard/integrations");

  // Wait for and click whichever sync button is present. The page has
  // one card per connected provider; we take the first visible
  // "Sync now" style action.
  const syncButton = page
    .getByRole("button", { name: /sync (now|history|sales|orders)/i })
    .first();

  if (!(await syncButton.isVisible().catch(() => false))) {
    test.skip(
      true,
      "No POS provider connected for TARGET_USER_ID — UI flow not runnable. " +
        "Run the API-only spec (impersonation-blocks-mutation.spec.ts) instead."
    );
    return;
  }

  // Listen for the sync POST response.
  const syncResponse = page.waitForResponse(
    (r) => /\/api\/pos\/(square|toast|clover)\/sync/.test(r.url()) && r.request().method() === "POST",
    { timeout: 10_000 }
  );
  await syncButton.click();
  const response = await syncResponse;

  expect(response.status()).toBe(403);
  expect(response.headers()["x-impersonation-blocked"]).toBe("1");

  // Cleanup — stop impersonation so the storage state file used by
  // other tests doesn't leak a live impersonation cookie.
  await page.request.post("/api/admin/impersonate/stop");
});
