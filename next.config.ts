import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps so stack traces show real line numbers, not minified code
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Silences the Sentry build output — errors still surface
  silent: !process.env.CI,

  // Disable telemetry pings back to Sentry during build
  telemetry: false,

  webpack: {
    // Don't auto-instrument middleware (we don't use it)
    autoInstrumentMiddleware: false,
    // Tree-shake Sentry debug logging out of the production bundle
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
