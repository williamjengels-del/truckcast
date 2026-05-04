// Next.js instrumentation hook — required by Sentry 10 + Next 16 to
// load the server-side and edge-side SDK init code at runtime.
//
// Without this file the legacy `sentry.server.config.ts` /
// `sentry.edge.config.ts` files at the project root are NOT
// auto-loaded (the auto-detect convention was dropped in Sentry 8).
// The SDK silently fails to initialize, no events ship, and the
// project home stays in the "Set up the SDK" empty state forever.
//
// `register()` runs once per Next.js runtime (Node.js server pages,
// edge middleware, etc.). NEXT_RUNTIME is set automatically by Next.
//
// `onRequestError` is the hook Sentry uses to capture errors thrown
// inside React Server Components — it has to be re-exported from
// here even though all the configuration lives in the
// sentry.server.config / sentry.edge.config files.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
