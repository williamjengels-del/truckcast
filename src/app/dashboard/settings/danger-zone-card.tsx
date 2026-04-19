"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, AlertCircle } from "lucide-react";

// Danger Zone — destructive actions that can't be undone. Mounted at
// the bottom of Settings. Currently just "reset my account data."
//
// Moved here from /admin/developer-tools in Commit 7. The old admin-
// only button was a dev shortcut; relocating to Settings makes this
// a first-class user-facing capability (any authenticated user can
// wipe their own event / contact / booking data).

export function DangerZoneCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleReset() {
    const ok = window.confirm(
      "Reset my account — wipes my event/contact/booking data.\n\n" +
        "This permanently deletes:\n" +
        "  • All events + performance history\n" +
        "  • All contacts\n" +
        "  • All booking requests\n" +
        "  • Onboarding state (you'll go through setup again)\n\n" +
        "Your subscription, email, and account itself remain.\n\n" +
        "Cannot be undone. Proceed?"
    );
    if (!ok) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/reset", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Reset failed (HTTP ${res.status})`);
        setLoading(false);
        return;
      }
      setDone(true);
      // Give a moment to read the confirmation, then hand off to the
      // onboarding wizard (the profile now has onboarding_completed=false
      // so the middleware will redirect there anyway on next nav).
      setTimeout(() => {
        window.location.href = "/dashboard/onboarding";
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-2xl border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="font-medium text-sm">Reset my account</div>
          <p className="text-sm text-muted-foreground">
            Wipes my event / contact / booking data and sends me back to
            onboarding. Subscription tier, email, and account stay intact.
            Cannot be undone.
          </p>
        </div>
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {done ? (
          <p className="text-sm text-green-600 dark:text-green-400 font-medium">
            ✓ Account wiped. Redirecting to onboarding…
          </p>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleReset}
            disabled={loading}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {loading ? "Wiping…" : "Reset my account"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
