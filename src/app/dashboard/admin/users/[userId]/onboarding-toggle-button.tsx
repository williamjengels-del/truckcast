"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Admin-only toggle for an operator's onboarding_completed flag.
// Calls PATCH /api/admin/users/[userId]/onboarding which writes via
// service role and audit-logs as user.onboarding_set.
//
// The flag gates marketplace inquiry routing — operators with
// onboarding_completed=false are skipped by /request-event matching.
// This button is the lightweight alternative to having an operator
// re-walk the wizard.

interface Props {
  userId: string;
  targetLabel: string;
  initialValue: boolean;
}

export function OnboardingToggleButton({
  userId,
  targetLabel,
  initialValue,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function flip() {
    const next = !value;
    const verb = next ? "Mark onboarded" : "Reset onboarding";
    const body = next
      ? `Mark ${targetLabel} as onboarded? They'll skip the setup wizard and become eligible for marketplace inquiry routing.`
      : `Reset ${targetLabel}'s onboarding? They'll be sent back through the setup wizard the next time they open the dashboard.`;
    if (!confirm(body)) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/users/${userId}/onboarding`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onboarding_completed: next }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `${verb} failed (HTTP ${res.status})`);
        setWorking(false);
        return;
      }
      setValue(next);
      setWorking(false);
      // Refresh the parent server component so the page header's
      // "Onboarding incomplete" badge updates without a hard reload.
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setWorking(false);
    }
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Onboarding</p>
          <p className="text-xs text-muted-foreground">
            {value
              ? "Completed — eligible for marketplace inquiry routing."
              : "Not completed — skipped by /request-event matching until flipped."}
          </p>
        </div>
        <Button
          variant={value ? "ghost" : "default"}
          size="sm"
          onClick={flip}
          disabled={working}
          className="shrink-0"
        >
          {working ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving…
            </>
          ) : value ? (
            <>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Reset onboarding
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Mark onboarded
            </>
          )}
        </Button>
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
