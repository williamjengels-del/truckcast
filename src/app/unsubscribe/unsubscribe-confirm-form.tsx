"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Client form for the unsubscribe confirmation step. Posts the same
// per-user signed token the page-load verified; the API re-verifies
// server-side before flipping the flag (defense in depth — never
// trust that the page-load check is the only gate).
export function UnsubscribeConfirmForm({
  userId,
  token,
}: {
  userId: string;
  token: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Couldn't process the request.");
        setSubmitting(false);
        return;
      }
      // Reload the page in `?done=1` mode — the server component
      // renders the success state. Avoids a separate client-state
      // success screen that would duplicate UI.
      router.replace("/unsubscribe?done=1");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full border border-input bg-background hover:bg-muted disabled:opacity-60 text-foreground font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
      >
        {submitting ? "Unsubscribing..." : "Confirm unsubscribe"}
      </button>
    </form>
  );
}
