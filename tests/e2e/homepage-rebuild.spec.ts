import { test, expect, type Page } from "@playwright/test";

// Homepage spec — last refreshed 2026-04-27 for Phase 2.0 IA reorder.
// (History: locked 2026-04-24 for the original homepage rebuild —
// removals: testimonials / how-it-works / on-page pricing; additions:
// three insight blocks + operator-direct positioning block; tightening:
// feature-grid copy, single CTA, subline.)
//
// Phase 2.0 changes asserted here:
//  - Hero supporting line + pill CTA in the teal band
//  - Card grid reordered: Inquiries → Weather → Repeats → Timing
//    (per Verdict #12, inquiry flow leads acquisition)
//  - Density inversion on each card: claim becomes the H2, stat sits
//    below, body tightens to one sentence, italic punchline cut
//  - Stats row: "Within 16%" reads as accuracy jargon, replaced with
//    "4 out of 5 forecasts land in range" (same number inverted)
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

  test("four insight blocks render in inquiry-first order with claim-led density", async ({
    page,
  }) => {
    // Block 1 — Inquiries (operator-direct positioning, anchored by 0% fee).
    const inquiries = page.getByTestId("insight-block-inquiries");
    await expect(inquiries).toBeVisible();
    await expect(inquiries).toContainText(
      "Real inquiries, straight to operators. First to respond, first to book."
    );
    await expect(page.getByTestId("insight-finding-inquiries")).toHaveText("0%");
    await expect(inquiries).toContainText("marketplace fee");
    await expect(inquiries).toContainText("not a marketplace that takes 15%");

    // Block 2 — Weather. Stat is dynamic ($NNN or placeholder).
    const weather = page.getByTestId("insight-block-weather");
    await expect(weather).toBeVisible();
    await expect(weather).toContainText("Bad-weather risk, flagged before you commit.");
    await expect(
      page.getByTestId("insight-finding-weather")
    ).toHaveText(/^\$\d{1,3}(,\d{3})*$|^\{\{WEATHER_LOSS_DOLLARS\}\}$/);
    await expect(weather).toContainText("lost on average per weather-disrupted event");
    await expect(weather).toContainText("Rain, heat, cold snaps");

    // Block 3 — Repeat bookings. Stat is dynamic (NN% or placeholder).
    const repeats = page.getByTestId("insight-block-repeats");
    await expect(repeats).toBeVisible();
    await expect(repeats).toContainText(
      "Know which repeat bookings are still earning their keep."
    );
    await expect(
      page.getByTestId("insight-finding-repeats")
    ).toHaveText(/^\d{1,2}%$|^\{\{REPEAT_BOOKING_DECLINE_RATE\}\}$/);
    await expect(repeats).toContainText("declining revenue by year three");

    // Block 4 — Revenue timing (qualitative, no invented numeric).
    const timing = page.getByTestId("insight-block-timing");
    await expect(timing).toBeVisible();
    await expect(timing).toContainText(
      "Match prep and staffing to when the money actually arrives."
    );
    await expect(timing).toContainText("A 6-hour event isn't 6 hours of revenue.");
    await expect(timing).toContainText(
      "VendCast tracks when, not just when the day ends."
    );
  });

  test("italic-punchline pattern is gone — density inversion lands the claim in the H2", async ({
    page,
  }) => {
    // The pre-Phase-2.0 cards ended each block with an italic
    // muted-foreground paragraph that carried the actual claim. Phase
    // 2.0 promotes that claim into the H2, so the italic should not
    // appear inside any insight block.
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

  test("feature grid renders exactly 5 cards with editorial copy", async ({ page }) => {
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

    await expect(page.getByTestId("feature-card-forecasting")).toContainText(
      "Event Forecasting"
    );
    await expect(page.getByTestId("feature-card-fee-calculator")).toContainText(
      "Fee Calculator"
    );
  });

  test("stats row uses operator-readable wins, not accuracy jargon", async ({ page }) => {
    const row = page.getByTestId("stats-row");
    await expect(row).toBeVisible();
    // Phase 2.0: "Within 16%" → "4 out of 5 forecasts land in range" (same
    // number inverted from miss-rate to hit-rate).
    await expect(page.getByTestId("stats-accuracy")).toContainText("4 out of 5");
    await expect(page.getByTestId("stats-accuracy")).toContainText(
      "forecasts land in range"
    );
    await expect(page.getByTestId("stats-accuracy")).not.toContainText("Within 16%");
    await expect(page.getByTestId("stats-years")).toContainText("5 years");
    await expect(page.getByTestId("stats-events")).toContainText(/\d[\d,]*\+/);
  });

  test("Start-free-trial CTA appears in both hero and footer regions", async ({ page }) => {
    // Phase 2.0: hero now has its own pill CTA; footer CTA still
    // exists. Two total renderings of "Start free trial" are expected.
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
    // Nav region is present. Individual link visibility varies by
    // viewport — the Roadmap anchor is `hidden sm:block`, so we don't
    // pin visibility here; the HTTP check above covers reachability.
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();
  });

  test("viewport: no horizontal scroll + structural baseline screenshot", async ({
    page,
  }, testInfo) => {
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(
      horizontalOverflow,
      `Horizontal overflow should be 0 (was ${horizontalOverflow}) at viewport ${testInfo.project.name}`
    ).toBeLessThanOrEqual(0);

    // Layout: 2×2 grid on desktop (md ≥ 768px), single column on mobile.
    //   Desktop: row 1 = inquiries + weather, row 2 = repeats + timing.
    //            Blocks in the same row share ~the same `y`.
    //   Mobile:  all four stack; `y` increases monotonically.
    const inquiriesBox = await page.getByTestId("insight-block-inquiries").boundingBox();
    const weatherBox = await page.getByTestId("insight-block-weather").boundingBox();
    const repeatsBox = await page.getByTestId("insight-block-repeats").boundingBox();
    const timingBox = await page.getByTestId("insight-block-timing").boundingBox();
    expect(
      inquiriesBox && weatherBox && repeatsBox && timingBox
    ).toBeTruthy();
    if (inquiriesBox && weatherBox && repeatsBox && timingBox) {
      const viewportWidth = page.viewportSize()?.width ?? 0;
      const isDesktop = viewportWidth >= 768;
      if (isDesktop) {
        // Same-row: y-offset within a small tolerance of each other.
        const ROW_TOL = 20;
        expect(Math.abs(inquiriesBox.y - weatherBox.y)).toBeLessThanOrEqual(ROW_TOL);
        expect(Math.abs(repeatsBox.y - timingBox.y)).toBeLessThanOrEqual(ROW_TOL);
        // Row 2 is below row 1.
        expect(repeatsBox.y).toBeGreaterThanOrEqual(inquiriesBox.y + inquiriesBox.height - 1);
        // Columns are horizontally distinct — weather sits to the right of inquiries.
        expect(weatherBox.x).toBeGreaterThan(inquiriesBox.x + inquiriesBox.width / 2);
        expect(timingBox.x).toBeGreaterThan(repeatsBox.x + repeatsBox.width / 2);
      } else {
        // Mobile: all four stacked, y monotonically increasing.
        expect(weatherBox.y).toBeGreaterThanOrEqual(inquiriesBox.y + inquiriesBox.height - 1);
        expect(repeatsBox.y).toBeGreaterThanOrEqual(weatherBox.y + weatherBox.height - 1);
        expect(timingBox.y).toBeGreaterThanOrEqual(repeatsBox.y + repeatsBox.height - 1);
      }
    }

    // Fresh baseline screenshot — first run creates artifacts at a
    // stable path; document this in the summary so Julian knows these
    // aren't regression-diffed yet.
    const screenshotPath = testInfo.outputPath(`homepage-${testInfo.project.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`homepage-${testInfo.project.name}.png`, {
      path: screenshotPath,
      contentType: "image/png",
    });
  });
});
