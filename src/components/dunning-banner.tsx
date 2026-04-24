"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Dashboard-top banner shown when the operator's most recent renewal
 * failed or Stripe has escalated their subscription to past_due.
 *
 * Driven by profiles.last_payment_status (written by the Stripe
 * webhook handlers at /api/stripe/webhook — PR #19 + PR #25 seeded
 * the values). Rendered as a server-computed prop on the dashboard
 * page so first paint carries the banner; the "Update card" button
 * is the client bit that hits /api/stripe/portal for the Stripe
 * customer-portal redirect.
 *
 * Visual weight intentionally heavy — amber on payment_failed,
 * destructive on past_due. Dunning isn't a nudge, it's a
 * "your-account-will-downgrade-if-you-don't-act" signal.
 */

export interface DunningBannerProps {
  /** "payment_failed" | "past_due" — any other value means no banner. */
  status: string | null | undefined;
  /** Stripe-reported reason for the failure (e.g. "Your card was declined."). */
  failureReason?: string | null;
}

function isDunningState(status: string | null | undefined): boolean {
  return status === "payment_failed" || status === "past_due";
}

export function DunningBanner({ status, failureReason }: DunningBannerProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isDunningState(status)) return null;

  const isPastDue = status === "past_due";

  async function handleUpdateCard() {
    setRedirecting(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Couldn't open billing portal (${res.status})`);
        setRedirecting(false);
        return;
      }
      const body = await res.json();
      if (body.url) {
        window.location.href = body.url;
      } else {
        setError("Billing portal URL missing from response");
        setRedirecting(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open billing portal");
      setRedirecting(false);
    }
  }

  // Shared palette — amber for soft-warning (payment_failed), destructive
  // for hard-warning (past_due means Stripe's retry machinery gave up).
  const palette = isPastDue
    ? "border-destructive/40 bg-destructive/5 text-destructive dark:bg-destructive/10"
    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-200";
  const iconColor = isPastDue ? "text-destructive" : "text-amber-600 dark:text-amber-400";

  return (
    <div
      data-testid="dunning-banner"
      data-status={status}
      className={`rounded-lg border p-4 ${palette}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${iconColor}`} />
          <div className="space-y-1">
            <p className="font-semibold">
              {isPastDue
                ? "Your subscription is past due"
                : "We couldn't process your last payment"}
            </p>
            <p className="text-sm opacity-90">
              {isPastDue
                ? "Stripe couldn't collect after several retries. Your account will downgrade to Starter soon if the card isn't updated."
                : "Your card was declined on the most recent renewal. Stripe will retry automatically — updating the card now avoids the downgrade."}
            </p>
            {failureReason && (
              <p className="text-xs opacity-80 italic">Reason: {failureReason}</p>
            )}
            {error && <p className="text-xs font-medium mt-1">{error}</p>}
          </div>
        </div>
        <div className="shrink-0">
          <Button
            data-testid="dunning-banner-update-card"
            size="sm"
            variant={isPastDue ? "destructive" : "default"}
            onClick={handleUpdateCard}
            disabled={redirecting}
          >
            {redirecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Opening…
              </>
            ) : (
              "Update payment method"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
