"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, ArrowRight, Loader2 } from "lucide-react";

// "See how forecasts work" tile in the empty-dashboard 3-option layout.
//
// Pre-fix: this tile linked to /dashboard/insights?tab=forecasts, which
// is EMPTY for fresh accounts that haven't imported anything yet —
// operator clicked through expecting to see forecasts and got an empty
// page instead. A4 from the v60 brief queue.
//
// Post-fix: tile is a button that triggers the same /api/sample-data/seed
// flow as the SampleDataSeedButton below. Two paths to the same outcome
// (sample data loaded → operator can navigate to forecasts and see real
// numbers), at two different visual weights in the empty-state layout.
// The 3-option tile pattern is preserved.
//
// Refuses gracefully if sample data is already seeded (server-side check).
// Error surfaces inline at the bottom of the tile.

export function SeeForecastsTile() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-data/seed", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to load sample data");
        setLoading(false);
        return;
      }
      // Refresh re-renders the dashboard with sample data populated;
      // operator can then navigate to /dashboard/insights?tab=forecasts
      // (or look at the dashboard's own forecast chips) to see what
      // forecasts look like.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="group text-left h-full"
    >
      <div className="h-full rounded-xl border bg-card p-5 hover:border-primary/50 hover:shadow-md transition-all">
        <div className="w-10 h-10 rounded-lg bg-brand-teal/10 flex items-center justify-center mb-3">
          {loading ? (
            <Loader2 className="h-5 w-5 text-brand-teal animate-spin" />
          ) : (
            <TrendingUp className="h-5 w-5 text-brand-teal" />
          )}
        </div>
        <p className="font-semibold text-sm mb-1">See how forecasts work</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Load a sample operator&apos;s 4 months of events to see how
          forecasts, charts, and the day-of card look in action. Clear
          it anytime.
        </p>
        <p className="text-xs font-medium text-primary mt-3 flex items-center gap-1 group-hover:gap-2 transition-all">
          {loading ? "Loading…" : "Load sample data"}{" "}
          <ArrowRight className="h-3.5 w-3.5" />
        </p>
        {error && (
          <p className="text-xs text-destructive mt-2">{error}</p>
        )}
      </div>
    </button>
  );
}
