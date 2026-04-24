import { test, expect, type Page } from "@playwright/test";

// Homepage rebuild spec — locked in 2026-04-24 per the homepage-rebuild
// prompt (removals: testimonials / how-it-works / on-page pricing;
// additions: three insight blocks + operator-direct positioning block;
// tightening: feature-grid copy, single CTA, subline). No auth needed —
// runs via playwright.homepage.config.ts against a local dev server.
//
// Structural assertions go through data-testid so Brad's upcoming
// visual-polish pass can rename wrapper components without breaking
// the suite. Copy assertions use content strings because that copy IS
// the review artifact.

async function openHomepage(page: Page) {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), "GET / should return 2xx").toBeTruthy();
}

test.describe("Homepage rebuild", () => {
  test.beforeEach(async ({ page }) => {
    await openHomepage(page);
  });

  test("hero headline and updated subline render", async ({ page }) => {
    const headline = page.getByTestId("hero-headline");
    await expect(headline).toBeVisible();
    await expect(headline).toContainText("The operating system for");
    await expect(headline).toContainText("mobile vendors");

    const subline = page.getByTestId("hero-subline");
    await expect(subline).toBeVisible();
    await expect(subline).toHaveText("Built by a food truck operator. For mobile vendors.");
  });

  test("three insight blocks render with resolved numbers + remaining placeholders", async ({
    page,
  }) => {
    const weather = page.getByTestId("insight-block-weather");
    await expect(weather).toBeVisible();
    await expect(weather).toContainText("Weather patterns repeat. Losses don't have to.");
    // Weather-loss finding is either a live-queried "$NNN" value or the
    // fallback placeholder — both are valid render outcomes.
    await expect(
      page.getByTestId("insight-finding-weather")
    ).toHaveText(/^\$\d{1,3}(,\d{3})*$|^\{\{WEATHER_LOSS_DOLLARS\}\}$/);
    // Rain/Hot/Cold impacts are hardcoded from WEATHER_COEFFICIENTS.
    await expect(weather).toContainText("47% below average");
    await expect(weather).toContainText("37% below");
    await expect(weather).toContainText("45% below");
    await expect(weather).toContainText("flags bad-weather risk before you commit");

    const repeats = page.getByTestId("insight-block-repeats");
    await expect(repeats).toBeVisible();
    await expect(repeats).toContainText("Know which repeat bookings are still worth your time.");
    // Repeat-decline finding is either the live-queried "NN%" value or the
    // fallback placeholder when Supabase env vars / data aren't available.
    await expect(
      page.getByTestId("insight-finding-repeats")
    ).toHaveText(/^\d{1,2}%$|^\{\{REPEAT_BOOKING_DECLINE_RATE\}\}$/);
    await expect(repeats).toContainText("The math stops being a surprise");

    const timing = page.getByTestId("insight-block-timing");
    await expect(timing).toBeVisible();
    // Block 3 reframed 2026-04-24 — qualitative, no numeric placeholder.
    await expect(timing).toContainText("Your revenue curve isn't a daily average.");
    await expect(timing).toContainText("A 6-hour festival isn't 6 hours of revenue.");
    await expect(timing).toContainText("VendCast tracks when your money actually arrives");
  });

  test("positioning block renders", async ({ page }) => {
    const block = page.getByTestId("positioning-block");
    await expect(block).toBeVisible();
    await expect(block).toContainText("Event inquiries, operator-direct. No middleman.");
    await expect(block).toContainText("First to respond, first to book");
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

  test("stats row preserves validated numbers", async ({ page }) => {
    const row = page.getByTestId("stats-row");
    await expect(row).toBeVisible();
    await expect(page.getByTestId("stats-accuracy")).toContainText("Within 16%");
    await expect(page.getByTestId("stats-years")).toContainText("5 years");
    await expect(page.getByTestId("stats-events")).toContainText(/\d[\d,]*\+/);
  });

  test("single Start-free-trial CTA in the footer region", async ({ page }) => {
    const cta = page.getByTestId("cta-start-free-trial");
    await expect(cta).toHaveCount(1);
    await expect(cta).toContainText("Start free trial");
    await expect(page.locator("body")).toContainText("14 days free, no credit card required.");
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
    //   Desktop: row 1 = weather + repeats, row 2 = timing + positioning.
    //            Blocks in the same row share ~the same `y`.
    //   Mobile:  all four stack; `y` increases monotonically.
    const weatherBox = await page.getByTestId("insight-block-weather").boundingBox();
    const repeatsBox = await page.getByTestId("insight-block-repeats").boundingBox();
    const timingBox = await page.getByTestId("insight-block-timing").boundingBox();
    const positioningBox = await page.getByTestId("positioning-block").boundingBox();
    expect(
      weatherBox && repeatsBox && timingBox && positioningBox
    ).toBeTruthy();
    if (weatherBox && repeatsBox && timingBox && positioningBox) {
      const viewportWidth = page.viewportSize()?.width ?? 0;
      const isDesktop = viewportWidth >= 768;
      if (isDesktop) {
        // Same-row: y-offset within a small tolerance of each other.
        const ROW_TOL = 20;
        expect(Math.abs(weatherBox.y - repeatsBox.y)).toBeLessThanOrEqual(ROW_TOL);
        expect(Math.abs(timingBox.y - positioningBox.y)).toBeLessThanOrEqual(ROW_TOL);
        // Row 2 is below row 1.
        expect(timingBox.y).toBeGreaterThanOrEqual(weatherBox.y + weatherBox.height - 1);
        // Columns are horizontally distinct — repeats sits to the right of weather.
        expect(repeatsBox.x).toBeGreaterThan(weatherBox.x + weatherBox.width / 2);
        expect(positioningBox.x).toBeGreaterThan(timingBox.x + timingBox.width / 2);
      } else {
        // Mobile: all four stacked, y monotonically increasing.
        expect(repeatsBox.y).toBeGreaterThanOrEqual(weatherBox.y + weatherBox.height - 1);
        expect(timingBox.y).toBeGreaterThanOrEqual(repeatsBox.y + repeatsBox.height - 1);
        expect(positioningBox.y).toBeGreaterThanOrEqual(timingBox.y + timingBox.height - 1);
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
