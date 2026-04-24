import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./global-setup";

// Regression for the 2026-04-21 "one letter then loses focus" bug on the
// events search input (v9 brief Section 3, originally filed as
// impersonation-specific but confirmed 2026-04-23 to repro without
// impersonation too).
//
// Root cause: EventsClient performed 7 filter + 1 sort pass on the full
// events array on every render, plus recomputed `today` and
// `upcomingWith14DaysAndCity`. With 907+ events the synchronous render
// was heavy enough that React concurrent rendering dropped input focus
// after the first keystroke. Fix was wrapping the derived collections
// in useMemo so `search` only invalidates the final `filtered` pass.
//
// This spec proves the symptom doesn't recur. If it fails, the
// regression is back.

test.use({ storageState: ADMIN_STORAGE_STATE });

test("events search input retains focus while typing a full string", async ({ page }) => {
  await page.goto("/dashboard/events");

  // Find the search input. The placeholder is stable text so we anchor
  // on that; the input sits inside a relative wrapper with a Search
  // icon to its left (see events-client.tsx:1261).
  const searchInput = page.getByPlaceholder("Search events...");
  await expect(searchInput).toBeVisible({ timeout: 10_000 });

  await searchInput.click();
  await searchInput.pressSequentially("hello world", { delay: 50 });

  // After typing the full string, the input should contain it.
  // If focus was lost after the first keystroke (the regression),
  // only "h" would have landed — or some partial substring.
  await expect(searchInput).toHaveValue("hello world");

  // Also confirm the input is still the active element. If some
  // re-render is remounting the element, this assertion fails even if
  // the value happens to match.
  const isFocused = await searchInput.evaluate((el) => el === document.activeElement);
  expect(isFocused, "search input lost focus during typing").toBe(true);
});
