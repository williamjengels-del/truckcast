import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default withSentryConfig(nextConfig, {
  // Your Sentry org and project slugs (update these after you create the project)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for source map uploads (set in Vercel env vars as SENTRY_AUTH_TOKEN)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps so stack traces show real line numbers, not minified code
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Silences the Sentry build output — errors still surface
  silent: !process.env.CI,

  // Disable the automatic /monitoring route (we don't need it)
  autoInstrumentMiddleware: false,

  // Don't inject Sentry into the dev server
  disableLogger: true,
});
