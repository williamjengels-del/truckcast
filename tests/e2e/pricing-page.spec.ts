import { test, expect, type Page } from "@playwright/test";

// /pricing structural spec — locked 2026-04-28 to mirror the homepage
// spec pattern.
//
// Asserts the structural choices behind the Phase 2 marketing surface:
//   * three tier cards, no "most popular" badge (no real subscribers
//     yet — would be a fabricated trust signal)
//   * monthly default + annual toggle (per v13 §5)
//   * founder-story slot below tiers
//   * each tier CTA → /signup with ?plan + ?billing URL params
//   * brand-teal hero band + brand-orange "Save up to $X/yr" hint
//
// Mobile sticky CTA assertion deliberately NOT included — it ships in
// PR #45 (separate); add an assertion for `pricing-mobile-sticky-cta`
// once that lands.
//
// Runs via playwright.homepage.config.ts (testMatch broadened to also
// catch this file). No auth needed.

async function openPricing(page: Page) {
  const response = await page.goto("/pricing", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), "GET /pricing should return 2xx").toBeTruthy();
}

test.describe("/pricing", () => {
  test.beforeEach(async ({ page }) => {
    await openPricing(page);
  });

  test("hero band renders headline + subline", async ({ page }) => {
    const headline = page.getByTestId("pricing-headline");
    await expect(headline).toBeVisible();
    await expect(headline).toHaveText("Simple pricing. Built for mobile vendors.");

    const subline = page.getByTestId("pricing-subline");
    await expect(subline).toBeVisible();
    await expect(subline).toContainText("Three tiers");
    await expect(subline).toContainText("Pay monthly or save with annual.");
  });

  test("three tier cards render in canonical order with monthly default", async ({
    page,
  }) => {
    const cards = page.locator('[data-testid^="pricing-card-"]').filter({
      // Exclude the price + CTA child testids — only count the tier cards.
      hasNotText: /^$/,
    });

    // Each tier renders exactly once.
    await expect(page.getByTestId("pricing-card-starter")).toBeVisible();
    await expect(page.getByTestId("pricing-card-pro")).toBeVisible();
    await expect(page.getByTestId("pricing-card-premium")).toBeVisible();

    // Default is monthly — prices match PRICING_PLANS monthly values.
    await expect(page.getByTestId("pricing-card-starter-price")).toHaveText("$19");
    await expect(page.getByTestId("pricing-card-pro-price")).toHaveText("$39");
    await expect(page.getByTestId("pricing-card-premium-price")).toHaveText("$69");

    // Tier cards each carry their own CTA.
    await expect(page.getByTestId("pricing-card-starter-cta")).toBeVisible();
    await expect(page.getByTestId("pricing-card-pro-cta")).toBeVisible();
    await expect(page.getByTestId("pricing-card-premium-cta")).toBeVisible();

    // Sanity: a generic count check (in case a 4th tier sneaks in
    // without spec update).
    await expect(cards).toHaveCount(3);
  });

  test("monthly/annual toggle switches prices and surfaces the savings hint", async ({
    page,
  }) => {
    const monthlyBtn = page.getByTestId("pricing-toggle-monthly");
    const annualBtn = page.getByTestId("pricing-toggle-annual");
    const savingsHint = page.getByTestId("pricing-toggle-savings");

    // Initial: monthly selected, savings hint hidden.
    await expect(monthlyBtn).toBeVisible();
    await expect(annualBtn).toBeVisible();
    // Savings span is in the DOM but opacity-0 / aria-hidden when
    // monthly. Don't assert visibility — assert text + aria.
    await expect(savingsHint).toContainText(/Save up to \$\d/);
    await expect(savingsHint).toHaveAttribute("aria-hidden", "true");

    // Click annual → prices switch + savings hint becomes "visible"
    // (aria-hidden flips to false).
    await annualBtn.click();
    await expect(savingsHint).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByTestId("pricing-card-starter-price")).toHaveText("$182");
    await expect(page.getByTestId("pricing-card-pro-price")).toHaveText("$374");
    await expect(page.getByTestId("pricing-card-premium-price")).toHaveText("$662");

    // Per-card "Save $X/yr" line — single dollar sign (caught the
    // doubled-$$ regression in PR #43 fix).
    const starterCard = page.getByTestId("pricing-card-starter");
    await expect(starterCard).toContainText(/Save \$46\/yr/);
    await expect(starterCard).not.toContainText(/Save \$\$/);

    // Click monthly → reverts.
    await monthlyBtn.click();
    await expect(savingsHint).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("pricing-card-starter-price")).toHaveText("$19");
  });

  test("each tier CTA links to /signup with plan + billing URL params", async ({
    page,
  }) => {
    // Default monthly billing.
    const starterHref = await page
      .getByTestId("pricing-card-starter-cta")
      .locator("..")
      .getAttribute("href");
    expect(starterHref).toBe("/signup?plan=starter&billing=monthly");

    const proHref = await page
      .getByTestId("pricing-card-pro-cta")
      .locator("..")
      .getAttribute("href");
    expect(proHref).toBe("/signup?plan=pro&billing=monthly");

    const premiumHref = await page
      .getByTestId("pricing-card-premium-cta")
      .locator("..")
      .getAttribute("href");
    expect(premiumHref).toBe("/signup?plan=premium&billing=monthly");

    // Switch to annual — hrefs update.
    await page.getByTestId("pricing-toggle-annual").click();
    const starterAnnualHref = await page
      .getByTestId("pricing-card-starter-cta")
      .locator("..")
      .getAttribute("href");
    expect(starterAnnualHref).toBe("/signup?plan=starter&billing=annual");
  });

  test("no 'most popular' badge anywhere on the page", async ({ page }) => {
    // Per v13 §5: dropped the "most popular" badge — would be a
    // fabricated trust signal until we have real subscribers. Spec
    // makes the absence enforceable.
    const body = page.locator("body");
    await expect(body).not.toContainText(/most popular/i);
    await expect(body).not.toContainText(/recommended/i);
    await expect(body).not.toContainText(/best value/i);
  });

  test("founder story renders below tier cards", async ({ page }) => {
    const story = page.getByTestId("founder-story");
    await expect(story).toBeVisible();
    await expect(story).toContainText("Built by an operator who needed it first.");
    await expect(story).toContainText("Wok-O Taco");
    await expect(story).toContainText("Julian Engels, founder");
  });

  test("bottom CTA + footer reachable", async ({ page, request }) => {
    const bottomCta = page.getByTestId("pricing-bottom-cta");
    await expect(bottomCta).toBeVisible();
    await expect(bottomCta).toContainText("Start free trial");
    await expect(page.locator("body")).toContainText(/14 days free/);

    // Footer nav links return 200 (cheap reachability check).
    for (const path of ["/help", "/contact", "/signup"]) {
      const res = await request.get(path);
      expect(res.status(), `${path} should return 2xx`).toBeLessThan(400);
    }
  });

  test("viewport: no horizontal scroll + tier cards stack on mobile", async ({
    page,
  }) => {
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(0);

    const starterBox = await page.getByTestId("pricing-card-starter").boundingBox();
    const proBox = await page.getByTestId("pricing-card-pro").boundingBox();
    const premiumBox = await page.getByTestId("pricing-card-premium").boundingBox();
    expect(starterBox && proBox && premiumBox).toBeTruthy();
    if (starterBox && proBox && premiumBox) {
      const viewportWidth = page.viewportSize()?.width ?? 0;
      const isDesktop = viewportWidth >= 768;
      if (isDesktop) {
        // 3-across at desktop — same row, distinct columns.
        const ROW_TOL = 20;
        expect(Math.abs(starterBox.y - proBox.y)).toBeLessThanOrEqual(ROW_TOL);
        expect(Math.abs(proBox.y - premiumBox.y)).toBeLessThanOrEqual(ROW_TOL);
        expect(proBox.x).toBeGreaterThan(starterBox.x + starterBox.width / 2);
        expect(premiumBox.x).toBeGreaterThan(proBox.x + proBox.width / 2);
      } else {
        // Mobile: stack in source order (starter → pro → premium).
        expect(proBox.y).toBeGreaterThanOrEqual(starterBox.y + starterBox.height - 1);
        expect(premiumBox.y).toBeGreaterThanOrEqual(proBox.y + proBox.height - 1);
      }
    }
  });
});
