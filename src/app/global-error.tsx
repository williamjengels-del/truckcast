"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground max-w-sm">
              We hit an unexpected error. Our team has been notified automatically.
              Try refreshing — it usually clears up on its own.
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
              Go to dashboard
            </Button>
          </div>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono">
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
