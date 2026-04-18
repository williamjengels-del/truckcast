import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,

  async redirects() {
    return [
      // Legacy domain → canonical vendcast.co
      {
        source: "/:path*",
        has: [{ type: "host", value: "truckcast.co" }],
        destination: "https://vendcast.co/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.truckcast.co" }],
        destination: "https://vendcast.co/:path*",
        permanent: true,
      },

      // Phase 4 IA consolidation — preserve bookmarks + operator muscle memory.
      // Source match is exact (no trailing /:path*) so dynamic sub-routes like
      // /dashboard/forecasts/calculator and /dashboard/performance/[name] still
      // resolve to their own pages.
      {
        source: "/dashboard/forecasts",
        destination: "/dashboard/insights?tab=forecasts",
        permanent: true,
      },
      {
        source: "/dashboard/performance",
        destination: "/dashboard/insights?tab=performance",
        permanent: true,
      },
      {
        source: "/dashboard/analytics",
        destination: "/dashboard/insights?tab=analytics",
        permanent: true,
      },
      {
        source: "/dashboard/reports",
        destination: "/dashboard/insights?tab=reports",
        permanent: true,
      },
      {
        source: "/dashboard/followers",
        destination: "/dashboard/contacts?tab=followers",
        permanent: true,
      },
      {
        source: "/dashboard/events/import",
        destination: "/dashboard/integrations?tab=csv-import",
        permanent: true,
      },
      {
        source: "/dashboard/settings/pos",
        destination: "/dashboard/integrations?tab=pos",
        permanent: true,
      },
      // /dashboard/inbox alias for the renamed Bookings page.
      {
        source: "/dashboard/inbox",
        destination: "/dashboard/bookings",
        permanent: true,
      },
    ];
  },
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
