// Small client-side helper for mutation handlers that want to show
// a tailored error message when a write is rejected by the Commit 5b
// proxy mutation block during active admin impersonation.
//
// The proxy tags those 403s with `x-impersonation-blocked: 1` so
// callers can distinguish them from other 403s (RLS rejection,
// subscription-tier gates, etc.). Without this check, a generic
// "Save failed" error is still informative when the impersonation
// banner is already visible — but a targeted inline message ("This
// action is disabled during read-only impersonation") is clearer.
//
// Usage pattern:
//
//   const res = await fetch("/api/...", { method: "POST", ... });
//   if (wasImpersonationBlock(res)) {
//     setError("Read-only while impersonating. Exit impersonation to edit.");
//     return;
//   }
//   // ... normal error handling
//
// Not retrofitted into every mutation handler in the codebase yet —
// the prominent impersonation banner makes read-only mode obvious on
// its own. Wire this in at specific handlers if the generic error
// surface starts causing real confusion during use.

export function wasImpersonationBlock(response: Response): boolean {
  return (
    response.status === 403 &&
    response.headers.get("x-impersonation-blocked") === "1"
  );
}
