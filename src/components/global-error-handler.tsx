"use client";

import { useEffect } from "react";

/**
 * Suppresses unhandled "Failed to fetch" errors that come from browser extensions.
 * These are not VendCast bugs — they're caused by extensions making requests that
 * get blocked by CORS or ad blockers. Without this, they show up in the console
 * as uncaught errors which looks bad.
 */
export function GlobalErrorHandler() {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const msg =
        event.reason?.message || event.reason?.toString?.() || "";
      // Suppress extension-related fetch failures
      if (
        msg.includes("Failed to fetch") ||
        msg.includes("Load failed") ||
        msg.includes("NetworkError") ||
        msg.includes("net::ERR_BLOCKED_BY_CLIENT")
      ) {
        event.preventDefault();
        return;
      }
    }

    function handleError(event: ErrorEvent) {
      const msg = event.message || "";
      if (
        msg.includes("Failed to fetch") ||
        msg.includes("Load failed") ||
        msg.includes("Script error")
      ) {
        event.preventDefault();
        return;
      }
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);

  return null;
}
