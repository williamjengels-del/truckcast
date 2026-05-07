import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";

const TRIAL_DAYS = 14;

/**
 * Match this date in middleware.ts — both must agree on when the hard gate fires.
 */
const HARD_GATE_DATE = new Date("2026-05-01T00:00:00Z");

export async function TrialBanner() {
  /* eslint-disable react-hooks/error-boundaries */
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("created_at, stripe_subscription_id, subscription_tier, trial_extended_until")
      .eq("id", user.id)
      .single();

    if (!profile) return null;

  // Paid subscribers or manually-granted tiers — no banner.
  // Covers Stripe subs AND admin-grant paths that set subscription_tier
  // directly without attaching a Stripe customer (e.g. comp / partner
  // accounts via the admin user-management UI).
  if (profile.stripe_subscription_id) return null;
  if (profile.subscription_tier && profile.subscription_tier !== "trial") return null;

  const now = new Date();

  // Use extended trial end if set and in the future; otherwise use created_at + 14 days
  let trialEnd: Date;
  if (profile.trial_extended_until && new Date(profile.trial_extended_until) > now) {
    trialEnd = new Date(profile.trial_extended_until);
  } else {
    const createdAt = new Date(profile.created_at);
    trialEnd = new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  }

  const msLeft = trialEnd.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  // Trial expired — closer surface (operator needs to upgrade), use
  // brand-orange tint. The hard-gate date in middleware.ts still
  // enforces access cutoff; no need to yell with a destructive palette.
  if (daysLeft <= 0) {
    const hardGateActive = now >= HARD_GATE_DATE;
    return (
      <div className="bg-brand-orange/10 border-b border-brand-orange/30 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-brand-orange shrink-0" />
          <span className="text-foreground font-medium">Your free trial has ended.</span>
          {hardGateActive ? (
            <span className="text-muted-foreground hidden sm:inline">Upgrade to keep your data and continue using VendCast.</span>
          ) : (
            <span className="text-muted-foreground hidden sm:inline">
              Full access continues until May 1 — upgrade anytime to lock in your plan.
            </span>
          )}
        </div>
        <Link
          href="/dashboard/settings?upgrade=true"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-orange/90 transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Upgrade now
        </Link>
      </div>
    );
  }

  // Active trial — only show banner in last 7 days to avoid annoying early users
  if (daysLeft > 7) return null;

  const urgency = daysLeft <= 3;

  // Two-state banner: urgent (≤3 days) leans on brand-orange as the
  // closer; relaxed (4-7 days) leans on brand-teal as default brand
  // presence — neither pretends to be a destructive warning.
  return (
    <div
      className={`border-b px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap ${
        urgency
          ? "bg-brand-orange/10 border-brand-orange/30"
          : "bg-brand-teal/5 border-brand-teal/20"
      }`}
    >
      <div className="flex items-center gap-2 text-sm">
        <Sparkles
          className={`h-4 w-4 shrink-0 ${urgency ? "text-brand-orange" : "text-brand-teal"}`}
        />
        <span className="font-medium text-foreground">
          {daysLeft === 1 ? "Last day" : `${daysLeft} days`} left in your free trial.
        </span>
        <span className="text-muted-foreground hidden sm:inline">
          Upgrade anytime to keep full access.
        </span>
      </div>
      <Link
        href="/dashboard/settings?upgrade=true"
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
          urgency
            ? "bg-brand-orange hover:bg-brand-orange/90"
            : "bg-brand-teal hover:bg-brand-teal/90"
        }`}
      >
        View plans
      </Link>
    </div>
  );
  } catch {
    // Never let the banner crash the dashboard
    return null;
  }
  /* eslint-enable react-hooks/error-boundaries */
}
