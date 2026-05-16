"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "slug_nudge_dismissed_v1";

interface SlugNudgeBannerProps {
  /** Whether the operator's tier includes a public schedule page.
   *  Starter doesn't, so they don't see the nudge. */
  slugEligible: boolean;
  /** Whether the operator has already claimed a slug. If yes, no
   *  nudge needed. */
  hasSlug: boolean;
}

/**
 * Tier-1 acquisition-axis nudge encouraging operators to claim their
 * `vendcast.co/<slug>` URL.
 *
 * Per `feedback_value_prop_priority` Tier-1 ACQUISITION axis: the
 * embeddable / public-URL inquiry surface is the wedge that gets
 * Cat 1 + Cat 2 operators ("no system today" / "bad system today")
 * to stick around. North-star origin: most mobile vendors don't have
 * a booking form on their website at all — the slug page IS theirs.
 *
 * Visibility rules:
 *   - Pro+ tier (Starter doesn't get a public schedule per pricing)
 *   - No `public_slug` set on profile yet
 *   - Not dismissed (localStorage flag, per-browser)
 *
 * Why on the dashboard and not /dashboard/settings — operators who
 * skipped the onboarding wizard's step-3 "Share your booking link"
 * card (or who signed up before that card existed) need to discover
 * the feature on the surface they actually visit. Settings is
 * destination-traffic; the dashboard is daily-traffic.
 *
 * Dismiss is permanent per browser. The slug can still be claimed
 * via Settings → Customers → "Your public URL"; the banner is the
 * prominent moment, not the only path.
 */
export function SlugNudgeBanner({
  slugEligible,
  hasSlug,
}: SlugNudgeBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
    }
  }, []);

  function handleDismiss() {
    setDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "true");
    }
  }

  // Don't render until mounted (avoids hydration mismatch from
  // localStorage). Don't render when criteria don't match.
  if (!mounted) return null;
  if (dismissed) return null;
  if (!slugEligible) return null;
  if (hasSlug) return null;

  return (
    <div
      data-testid="slug-nudge-banner"
      className="relative flex items-start gap-3 rounded-lg border border-brand-teal/30 bg-brand-teal/5 px-4 py-3 sm:items-center"
    >
      <Globe className="h-5 w-5 shrink-0 text-brand-teal" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Claim your bookable URL.
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          A page like{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
            vendcast.co/your-truck
          </code>{" "}
          for your bio and flyers — your schedule + an inquiry form,
          all in one link. Free with your plan.
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Link href="/dashboard/settings?tab=customers">
          <Button size="sm" className="h-8">
            Claim URL
          </Button>
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
