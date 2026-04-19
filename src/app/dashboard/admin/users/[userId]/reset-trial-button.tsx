"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Admin-only "Reset trial" action on the user detail page. Fires
// /api/admin/users/reset-trial which writes trial_extended_until =
// now + 14 days and records user.trial_reset in the audit log.
//
// Blocks on users with an active Stripe subscription (enforced
// server-side — this button also checks the prop to hide itself
// rather than showing a button that can only fail).

interface Props {
  userId: string;
  targetLabel: string;
  hasSubscription: boolean;
  currentExtendedUntil: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "none";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ResetTrialButton({
  userId,
  targetLabel,
  hasSubscription,
  currentExtendedUntil,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hasSubscription) {
    return (
      <div className="text-xs text-muted-foreground">
        Trial reset is unavailable — this user has an active Stripe subscription.
      </div>
    );
  }

  async function handleReset() {
    const ok = window.confirm(
      `Reset trial for ${targetLabel} to a fresh 14 days starting now?\n\n` +
        `Current extension: ${formatDate(currentExtendedUntil)}\n` +
        `This will overwrite trial_extended_until and log user.trial_reset to the audit trail.`
    );
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users/reset-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Reset failed (HTTP ${res.status})`);
        setSubmitting(false);
        return;
      }
      // Refresh the server-rendered detail page so subscription card
      // shows the new trial_extended_until immediately.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="font-medium text-sm">Reset trial</div>
        <div className="text-xs text-muted-foreground">
          Give {targetLabel} a fresh 14-day trial starting now. Current
          extension: {formatDate(currentExtendedUntil)}. Logged as{" "}
          <code className="font-mono text-xs bg-muted px-1 rounded">user.trial_reset</code>.
        </div>
        {error && (
          <div className="mt-1 text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleReset}
        disabled={submitting}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Resetting…
          </>
        ) : (
          <>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset trial
          </>
        )}
      </Button>
    </div>
  );
}
