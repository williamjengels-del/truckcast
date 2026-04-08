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
