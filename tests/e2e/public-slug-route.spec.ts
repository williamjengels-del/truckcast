import { test, expect } from "@playwright/test";

// Stage 3 public-slug resolver — `vendcast.co/<slug>`.
//
// Verifies:
//   * unknown slug → 404 + global not-found page renders
//   * reserved slug masquerading as a vendor URL → still 404
//     (defense-in-depth even though static routes shadow most reserved
//     names; this asserts the route-layer guard for slugs that are
//     reserved but don't have a corresponding static route)
//   * (optional, env-gated) known claimed slug → 200 + business name
//     visible + canonical link points back to /<slug>
//
// Runs without auth via playwright.homepage.config.ts. The success
// path is gated on TEST_PUBLIC_SLUG / TEST_PUBLIC_SLUG_BUSINESS_NAME
// because no fixture vendor exists in the test environment by default.

const UNKNOWN_SLUG = "definitely-not-a-real-vendor-slug-zz9";

test.describe("/<slug> public resolver", () => {
  test("unknown slug returns 404", async ({ page }) => {
    const res = await page.goto(`/${UNKNOWN_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status(), "unknown slug should be 404").toBe(404);
    // Global not-found.tsx copy.
    await expect(page.locator("body")).toContainText("Page not found");
  });

  test("reserved-but-unrouted slug returns 404", async ({ page }) => {
    // `landing` is in RESERVED_SLUGS but has no corresponding static
    // route in src/app/, so a request for it falls into the [slug]
    // catch-all where the route-layer reserved check should fire.
    // If a future PR ships /landing as a real page, swap this to
    // another reserved-but-unrouted name (e.g. "press", "blog", "faq").
    const res = await page.goto("/landing", { waitUntil: "domcontentloaded" });
    expect(res?.status(), "reserved slug should be 404").toBe(404);
    await expect(page.locator("body")).toContainText("Page not found");
  });

  test("malformed slug returns 404", async ({ page }) => {
    // Slug doesn't match SLUG_PATTERN (uppercase + dot). The route's
    // validateSlug short-circuits before any DB hit.
    const res = await page.goto("/NotASlug.123", {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status(), "malformed slug should be 404").toBe(404);
  });

  test("claimed slug renders business name + canonical link", async ({
    page,
  }) => {
    const slug = process.env.TEST_PUBLIC_SLUG;
    const expectedName = process.env.TEST_PUBLIC_SLUG_BUSINESS_NAME;
    test.skip(
      !slug || !expectedName,
      "Set TEST_PUBLIC_SLUG + TEST_PUBLIC_SLUG_BUSINESS_NAME to exercise the success path."
    );

    const res = await page.goto(`/${slug}`, { waitUntil: "domcontentloaded" });
    expect(res?.status(), `/${slug} should return 200`).toBe(200);

    await expect(
      page.getByTestId("public-schedule-business-name")
    ).toContainText(expectedName!);

    // Canonical link should point at the slug path so search engines
    // index /<slug> rather than the id-keyed /schedule/[userId].
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute(
      "href",
      new RegExp(`/${slug}$`)
    );
  });
});
