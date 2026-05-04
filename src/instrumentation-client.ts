// Browser-side Sentry init. In Sentry 10 + Next 15/16 this file is
// the canonical entry point for the client SDK — the legacy
// `sentry.client.config.ts` filename at the project root is no
// longer auto-detected. Without this file no Sentry browser code
// loads, no errors ship from the browser, and `Sentry` isn't even
// available on the page bundle.
//
// onRouterTransitionStart is the App Router equivalent of the
// pageload-tx hook — has to be re-exported here so Sentry can wire
// it into client-side navigations.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of sessions for performance monitoring (free tier friendly)
  tracesSampleRate: 0.1,

  // Only run in production — no noise from local dev
  enabled: process.env.NODE_ENV === "production",

  // Don't send PII — strip email/IP by default
  sendDefaultPii: false,

  // Ignore common browser noise that isn't actionable
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
    /^Network request failed/,
    /^Failed to fetch/,
    /^Load failed/,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
