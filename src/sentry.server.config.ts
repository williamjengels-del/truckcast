import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of server-side transactions
  tracesSampleRate: 0.1,

  // Only run in production
  enabled: process.env.NODE_ENV === "production",

  sendDefaultPii: false,
});
