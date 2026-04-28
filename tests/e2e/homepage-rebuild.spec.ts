import { test, expect, type Page } from "@playwright/test";

// Homepage spec — last refreshed 2026-04-28 for Phase 2.1 (restored
// Brad's 3+1 framing) + Phase 2.5 (feature grid brand integration).
// History:
//   * 2026-04-24: original homepage rebuild (removals: testimonials,
//     how-it-works, on-page pricing; additions: three insight blocks +
//     positioning block; tightening: feature grid copy, single CTA).
//   * 2026-04-27: Phase 2.0 IA reorder collapsed the 3+1 into a 4-equal
//     2x2 grid with Inquiries leading. Reverted in Phase 2.1.
//   * 2026-04-27 evening: Phase 2.1 restored 3 insights side-by-side
//     + 1 positioning band (full-bleed brand-orange), per Brad's
//     original framing + Verdict #25 (operator-acquisition wins on
//     conflict; orange = differentiator/closer + alternating accents).
//   * 2026-04-27 evening: Phase 2.5 feature grid icons in brand-teal
//     filled squares so the section carries brand presence after the
//     orange band above.
//
// Structural assertions go through data-testid so Brad's upcoming
// visual-polish pass can rename wrappers without breaking the suite.
// Copy assertions use content strings because that copy IS the
// review artifact.

async function openHomepage(page: Page) {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), "GET / should return 2xx").toBeTruthy();
}

test.describe("Homepage rebuild", () => {
  test.beforeEach(async ({ page }) => {
    await openHomepage(page);
  });

  test("hero renders headline, subline, supporting line, and pill CTA", async ({ page }) => {
    const headline = page.getByTestId("hero-headline");
    await expect(headline).toBeVisible();
    await expect(headline).toContainText("The operating system for");
    await expect(headline).toContainText("mobile vendors");

    const subline = page.getByTestId("hero-subline");
    await expect(subline).toBeVisible();
    await expect(subline).toHaveText("Built by a food truck operator. For mobile vendors.");

    const supporting = page.getByTestId("hero-supporting-line");
    await expect(supporting).toBeVisible();
    await expect(supporting).toHaveText(
      "Know what your next event will make before you book it."
    );

    const heroCta = page.getByTestId("hero-cta-start-trial");
    await expect(heroCta).toBeVisible();
    await expect(heroCta).toContainText("Start free trial");
  });

  test("three operations insights render side-by-side, ops-first, claim-led", async ({
    page,
  }) => {
    // Phase 2.1: three quantified ops insights (Weather / Repeats /
    // Timing) lead the page. Each card carries an H2 with the result
    // claim + a stat anchor + a one-sentence body. No italic
    // punchline — the claim was promoted into the H2.

    const weather = page.getByTestId("insight-block-weather");
    await expect(weather).toBeVisible();
    await expect(weather).toContainText("Bad-weather risk, flagged before you commit.");
    await expect(
      page.getByTestId("insight-finding-weather")
    ).toHaveText(/^\$\d{1,3}(,\d{3})*$|^\{\{WEATHER_LOSS_DOLLARS\}\}$/);
    await expect(weather).toContainText("lost on average per weather-disrupted event");
    await expect(weather).toContainText("Rain, heat, cold snaps");

    const repeats = page.getByTestId("insight-block-repeats");
    await expect(repeats).toBeVisible();
    await expect(repeats).toContainText("Know which repeats are still earning their keep.");
    await expect(
      page.getByTestId("insight-finding-repeats")
    ).toHaveText(/^\d{1,2}%$|^\{\{REPEAT_BOOKING_DECLINE_RATE\}\}$/);
    await expect(repeats).toContainText("declining revenue by year three");

    const timing = page.getByTestId("insight-block-timing");
    await expect(timing).toBeVisible();
    await expect(timing).toContainText(
      "Match prep and staffing to when the money actually arrives."
    );
    await expect(timing).toContainText("A 6-hour event isn't 6 hours of revenue.");
  });

  test("positioning band (Inquiries) closes the strategic argument in brand-orange", async ({
    page,
  }) => {
    // Phase 2.1: the four-block 2x2 collapsed to 3 insights + 1
    // positioning band. Inquiries is no longer a peer card — it's the
    // closing differentiator, full-bleed brand-orange, mirrors the
    // hero's teal band visually.
    const inquiries = page.getByTestId("insight-block-inquiries");
    await expect(inquiries).toBeVisible();
    await expect(inquiries).toContainText(
      "Real inquiries, straight to operators. First to respond, first to book."
    );
    await expect(page.getByTestId("insight-finding-inquiries")).toHaveText("0%");
    await expect(inquiries).toContainText("commission fee");
    await expect(inquiries).toContainText(
      "the inquiry goes directly to you"
    );
    await expect(inquiries).toContainText("not a marketplace that takes 15%");
    // The band should NOT contain "marketplace fee" — Phase 2.1 swapped
    // it to "commission fee" (Julian's call: more accurate framing of
    // what marketplaces actually charge).
    await expect(inquiries).not.toContainText("marketplace fee");
  });

  test("italic-punchline pattern is gone — density inversion lands the claim in the H2", async ({
    page,
  }) => {
    // Pre-Phase-2.0 cards ended with italic muted-foreground paragraphs
    // carrying the actual claim. Phase 2.0 promoted that claim into
    // the H2; Phase 2.1 keeps the discipline. Should be no trailing
    // italic in any insight block (cards or band).
    const insightBlocks = page.locator(
      '[data-testid^="insight-block-"]'
    );
    const blockCount = await insightBlocks.count();
    expect(blockCount).toBe(4);
    for (let i = 0; i < blockCount; i++) {
      const italics = insightBlocks.nth(i).locator("p.italic");
      await expect(
        italics,
        `Block ${i} should not contain a trailing italic punchline`
      ).toHaveCount(0);
    }
  });

  test("feature grid renders exactly 5 cards with editorial copy + brand-teal icon squares", async ({
    page,
  }) => {
    const cards = page.locator('[data-testid^="feature-card-"]');
    await expect(cards).toHaveCount(5);

    await expect(page.getByTestId("feature-card-inquiry-booking")).toContainText(
      "Inquiry & Booking Inbox"
    );
    await expect(page.getByTestId("feature-card-event-scheduling")).toContainText(
      "Event Scheduling & Tracking"
    );

    const posCard = page.getByTestId("feature-card-pos-sync");
    await expect(posCard).toContainText("POS & CSV Sync");
    await expect(posCard).toContainText("and more");
    // Phase 2.5 tightened POS body from 3 sentences to 2.
    await expect(posCard).toContainText("Sales log themselves, or import a CSV");

    await expect(page.getByTestId("feature-card-forecasting")).toContainText(
      "Event Forecasting"
    );
    await expect(page.getByTestId("feature-card-fee-calculator")).toContainText(
      "Fee Calculator"
    );

    // Phase 2.5: every feature card anchors its lucide icon in a
    // brand-teal filled square (white icon). Smoke-check that each
    // card contains an element whose className references brand-teal.
    for (let i = 0; i < 5; i++) {
      const iconHolder = cards.nth(i).locator("div.bg-brand-teal");
      await expect(
        iconHolder,
        "Each feature card should anchor its icon in a brand-teal square"
      ).toHaveCount(1);
    }
  });

  test("stats row uses operator-readable wins, not accuracy jargon", async ({ page }) => {
    const row = page.getByTestId("stats-row");
    await expect(row).toBeVisible();
    // Phase 2.0: "Within 16%" → "4 out of 5 forecasts land in range".
    await expect(page.getByTestId("stats-accuracy")).toContainText("4 out of 5");
    await expect(page.getByTestId("stats-accuracy")).toContainText(
      "forecasts land in range"
    );
    await expect(page.getByTestId("stats-accuracy")).not.toContainText("Within 16%");
    await expect(page.getByTestId("stats-years")).toContainText("5 years");
    await expect(page.getByTestId("stats-events")).toContainText(/\d[\d,]*\+/);
  });

  test("Start-free-trial CTA appears in both hero and footer regions", async ({ page }) => {
    const heroCta = page.getByTestId("hero-cta-start-trial");
    const footerCta = page.getByTestId("cta-start-free-trial");
    await expect(heroCta).toBeVisible();
    await expect(footerCta).toBeVisible();
    await expect(heroCta).toContainText("Start free trial");
    await expect(footerCta).toContainText("Start free trial");
    await expect(page.locator("body")).toContainText(
      "14 days free, no credit card required."
    );
  });

  test("removed sections do NOT render on the homepage", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).not.toContainText("What food truckers are saying");
    await expect(body).not.toContainText("How it works");
    await expect(body).not.toContainText("Predict Your Success");
    await expect(body).not.toContainText("Evaluate My Event");
    await expect(body).not.toContainText("Try the calculator");
    await expect(body).not.toContainText("✨");
    await expect(body).not.toContainText("Simple pricing");
    await expect(body).not.toContainText("$19");
    await expect(body).not.toContainText("$39");
    await expect(body).not.toContainText("$69");

    // No star SVGs from the testimonial rating strip.
    const starSvgs = page.locator("svg.lucide-star, svg[class*='lucide-star']");
    await expect(starSvgs).toHaveCount(0);
  });

  test("nav links return 200", async ({ page, request }) => {
    for (const path of ["/roadmap", "/contact", "/signup", "/login"]) {
      const res = await request.get(path);
      expect(res.status(), `${path} should return 2xx`).toBeLessThan(400);
    }
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();
  });

  test("viewport: no horizontal scroll + structural layout baseline", async ({
    page,
  }, testInfo) => {
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(
      horizontalOverflow,
      `Horizontal overflow should be 0 (was ${horizontalOverflow}) at viewport ${testInfo.project.name}`
    ).toBeLessThanOrEqual(0);

    // Phase 2.1 layout:
    //   Desktop (md ≥ 768px): three insight cards in a single row
    //     (Weather, Repeats, Timing — all sharing the same `y`),
    //     positioning band sits below the row, full-bleed.
    //   Mobile: all four blocks stack; `y` increases monotonically.
    const weatherBox = await page.getByTestId("insight-block-weather").boundingBox();
    const repeatsBox = await page.getByTestId("insight-block-repeats").boundingBox();
    const timingBox = await page.getByTestId("insight-block-timing").boundingBox();
    const inquiriesBox = await page.getByTestId("insight-block-inquiries").boundingBox();
    expect(
      weatherBox && repeatsBox && timingBox && inquiriesBox
    ).toBeTruthy();
    if (weatherBox && repeatsBox && timingBox && inquiriesBox) {
      const viewportWidth = page.viewportSize()?.width ?? 0;
      const isDesktop = viewportWidth >= 768;
      if (isDesktop) {
        // Three insights in a row — same `y` within tolerance.
        const ROW_TOL = 20;
        expect(Math.abs(weatherBox.y - repeatsBox.y)).toBeLessThanOrEqual(ROW_TOL);
        expect(Math.abs(repeatsBox.y - timingBox.y)).toBeLessThanOrEqual(ROW_TOL);
        // Columns horizontally distinct: weather < repeats < timing on x.
        expect(repeatsBox.x).toBeGreaterThan(weatherBox.x + weatherBox.width / 2);
        expect(timingBox.x).toBeGreaterThan(repeatsBox.x + repeatsBox.width / 2);
        // Positioning band sits below the row.
        expect(inquiriesBox.y).toBeGreaterThanOrEqual(
          weatherBox.y + weatherBox.height - 1
        );
      } else {
        // Mobile: all stack, y monotonically increasing in source order
        // (weather → repeats → timing → inquiries).
        expect(repeatsBox.y).toBeGreaterThanOrEqual(
          weatherBox.y + weatherBox.height - 1
        );
        expect(timingBox.y).toBeGreaterThanOrEqual(
          repeatsBox.y + repeatsBox.height - 1
        );
        expect(inquiriesBox.y).toBeGreaterThanOrEqual(
          timingBox.y + timingBox.height - 1
        );
      }
    }

    const screenshotPath = testInfo.outputPath(`homepage-${testInfo.project.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`homepage-${testInfo.project.name}.png`, {
      path: screenshotPath,
      contentType: "image/png",
    });
  });
});
