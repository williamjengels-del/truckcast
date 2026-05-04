#!/usr/bin/env node
/**
 * Capture three product screenshots for the homepage Phase 2.5
 * section. Authenticates as the dedicated demo operator account,
 * navigates to each surface, screenshots, saves to
 * /public/marketing/screenshots/.
 *
 * Why a dedicated demo account (not Julian's): the homepage shouldn't
 * leak any real operator's branding, and live data drifts week to
 * week — the screenshots would get stale fast. The demo account is
 * long-lived, seeded via /api/sample-data/seed, and never modified
 * outside seed runs.
 *
 * Prereqs:
 *   - The demo Supabase auth user exists. Create it via the Supabase
 *     dashboard with email DEMO_SCREENSHOT_EMAIL and a strong password,
 *     then complete onboarding (business_name "Sample Vendor Co",
 *     city "St. Louis", state "MO") so the dashboard renders fully.
 *   - Sample data is loaded for the account: log in once and click
 *     "Load sample data," or POST to /api/sample-data/seed.
 *   - Playwright Chromium is installed: `npx playwright install chromium`.
 *
 * Usage (from truckcast/):
 *   DEMO_SCREENSHOT_EMAIL=demo-screenshots@vendcast.co \
 *   DEMO_SCREENSHOT_PASSWORD='<password>' \
 *   APP_URL=https://vendcast.co \
 *   node scripts/capture-screenshots.mjs
 *
 * For a local capture against the dev server:
 *   APP_URL=http://localhost:3000 node scripts/capture-screenshots.mjs
 */

import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "marketing", "screenshots");

const APP_URL = process.env.APP_URL ?? "https://vendcast.co";
const EMAIL = process.env.DEMO_SCREENSHOT_EMAIL;
const PASSWORD = process.env.DEMO_SCREENSHOT_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    "Missing DEMO_SCREENSHOT_EMAIL or DEMO_SCREENSHOT_PASSWORD env. Aborting."
  );
  process.exit(1);
}

const VIEWPORT = { width: 1440, height: 900 };

/**
 * Each capture:
 *   - path:       URL path to navigate to (after login)
 *   - waitFor:    selector that must appear before screenshot fires
 *   - clip:       optional rectangle to tightly crop. Omit for
 *                 full-viewport. Coordinates are CSS pixels at 1440 wide.
 *   - file:       output filename in /public/marketing/screenshots/
 */
const CAPTURES = [
  {
    file: "todays-event.png",
    path: "/dashboard",
    // Day-of-event block has data-testid on its Card root.
    waitFor: '[data-testid="day-of-event-block"]',
    clipFromTestId: "day-of-event-block",
  },
  {
    file: "inquiry-inbox.png",
    path: "/dashboard/inquiries",
    // Inbox renders the inquiries list once data hydrates. We want
    // the engagement-signal card visible — wait for its copy.
    waitFor: 'text=/Picking up steam|On a few operators|Drawing real interest/',
    // No clip — full viewport so the card stack reads as a populated
    // inbox, not a single card.
    fullPage: false,
  },
  {
    file: "forecast-card.png",
    path: "/dashboard",
    // Forecast on the day-of card. If absent, fall back to a future
    // event's forecast inline (the events page has these too).
    waitFor: '[data-testid="day-of-event-block"]',
    clipFromTestId: "day-of-event-block",
    // Override path to a forecast-rich surface if needed; for v1
    // we capture the day-of card's forecast inline since it shows
    // weather + range together.
  },
];

async function login(page) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function captureOne(page, capture) {
  const target = `${APP_URL}${capture.path}`;
  console.log(`→ ${capture.file}: navigating to ${target}`);
  await page.goto(target, { waitUntil: "networkidle" });
  if (capture.waitFor) {
    await page.waitForSelector(capture.waitFor, { timeout: 30_000 });
  }
  // Small settle so any post-mount fade-in animations finish before
  // the shutter fires. Cheap insurance against half-rendered captures.
  await page.waitForTimeout(750);

  const outPath = resolve(OUT_DIR, capture.file);

  if (capture.clipFromTestId) {
    const handle = await page.$(`[data-testid="${capture.clipFromTestId}"]`);
    if (handle) {
      await handle.screenshot({ path: outPath, scale: "css" });
      console.log(`  saved (clipped to ${capture.clipFromTestId}) → ${outPath}`);
      return;
    }
    console.warn(
      `  testid ${capture.clipFromTestId} not found, falling back to viewport`
    );
  }

  await page.screenshot({
    path: outPath,
    fullPage: capture.fullPage ?? false,
    scale: "css",
  });
  console.log(`  saved → ${outPath}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // retina-quality output
  });
  const page = await context.newPage();

  console.log(`Logging in as ${EMAIL} at ${APP_URL}…`);
  await login(page);

  for (const c of CAPTURES) {
    await captureOne(page, c);
  }

  await browser.close();
  console.log("Done. Review the captures at public/marketing/screenshots/.");
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
