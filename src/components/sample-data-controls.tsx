"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, X } from "lucide-react";

// Two operator-visible UI surfaces for sample-data mode:
//
//   <SampleDataSeedButton /> — rendered on the empty-dashboard
//   getting-started layout. Lets prospects with zero events click
//   "Show me with sample data" and instantly see VendCast's full UX
//   (forecasts, charts, key takeaways) populated with realistic
//   synthetic events. Refuses if sample data is already present
//   (handled server-side; UI just surfaces the message).
//
//   <SampleDataBanner /> — rendered at the top of the dashboard
//   whenever the operator currently has any sample rows. Makes it
//   obvious they're in preview mode + gives one-click clear path.
//
// Both call /api/sample-data/{seed,clear} and refresh the page so
// the dashboard re-renders with the new state.

export function SampleDataSeedButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSeed() {
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
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-5 md:p-6">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-brand-teal/15 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-brand-teal" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">See VendCast with sample data</p>
          <p className="text-sm text-muted-foreground mt-1">
            Load a sample operator&apos;s 4 months of events so you can see how forecasts, charts, and the day-of card look in action. Clear it anytime with one click.
          </p>
          {error && (
            <p className="text-sm text-destructive mt-2">{error}</p>
          )}
        </div>
        <Button
          onClick={handleSeed}
          disabled={loading}
          variant="outline"
          className="shrink-0 border-brand-teal/40 hover:bg-brand-teal/10"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading…
            </>
          ) : (
            "Load sample data"
          )}
        </Button>
      </div>
    </div>
  );
}

export function SampleDataBanner({ count }: { count: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClear() {
    if (!window.confirm(`Clear ${count} sample event${count === 1 ? "" : "s"}? This won't affect your real events.`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-data/clear", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to clear sample data");
        setLoading(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-brand-teal/40 bg-brand-teal/5 p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-brand-teal shrink-0" />
          <p>
            <span className="font-medium text-brand-teal">Sample data preview.</span>{" "}
            <span className="text-muted-foreground">
              You&apos;re viewing {count} synthetic event{count === 1 ? "" : "s"}. Add a real event or clear sample data to switch to live mode.
            </span>
          </p>
        </div>
        <Button
          onClick={handleClear}
          disabled={loading}
          variant="outline"
          size="sm"
          className="shrink-0 border-brand-teal/40 hover:bg-brand-teal/10"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <X className="h-3.5 w-3.5 mr-1" />
              Clear sample data
            </>
          )}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive mt-2">{error}</p>
      )}
    </div>
  );
}
