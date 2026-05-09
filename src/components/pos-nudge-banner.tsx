"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plug, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "pos_nudge_dismissed_v1";

interface PosNudgeBannerProps {
  /** Whether the operator's tier includes POS integration. Starter
   *  doesn't get this feature, so they don't see the nudge. */
  posEligible: boolean;
  /** Whether the operator has already connected a POS. If yes, they
   *  don't need the nudge. */
  posConnected: boolean;
  /** Whether the operator has logged at least one sale. The nudge is
   *  contextual to manual sales entry — if they haven't logged any
   *  sales yet, the "automate next time" pitch makes no sense. */
  hasSales: boolean;
}

/**
 * Contextual nudge encouraging POS connection after the operator has
 * logged sales manually.
 *
 * Replaces the previous onboarding-wizard step 3 ("Connect your POS")
 * which got skipped almost universally — at signup time operators
 * aren't sitting at their truck with credentials in hand. The right
 * moment to ask about POS automation is when the operator has just
 * done the work that POS would have automated.
 *
 * Visibility rules:
 *   - Pro+ tier (Starter doesn't get POS integration)
 *   - No POS connection yet
 *   - At least one sale logged
 *   - Not dismissed (localStorage flag, per-browser)
 *
 * Dismiss is permanent per browser — operator can still wire up POS
 * via Integrations or via the SetupProgress checklist on the
 * dashboard. The banner is the prominent moment, not the only path.
 */
export function PosNudgeBanner({
  posEligible,
  posConnected,
  hasSales,
}: PosNudgeBannerProps) {
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
  if (!posEligible) return null;
  if (posConnected) return null;
  if (!hasSales) return null;

  return (
    <div
      data-testid="pos-nudge-banner"
      className="relative flex items-start gap-3 rounded-lg border border-brand-teal/30 bg-brand-teal/5 px-4 py-3 sm:items-center"
    >
      <Plug className="h-5 w-5 shrink-0 text-brand-teal" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Want this to happen automatically next time?
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your POS and sales log themselves to the right event
          after every shift.
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Link href="/dashboard/integrations?tab=pos">
          <Button size="sm" className="h-8">
            Connect POS
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
