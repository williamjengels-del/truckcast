"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Admin-only Tier-B chatbot monthly cap override on the user detail
// page. Sets profiles.chat_v2_monthly_cap_cents_override; null means
// "use the env default." Mutations go through /api/admin/users/[userId]/chat-cap
// which audit-logs as user.cap_override_set.

interface Props {
  userId: string;
  targetLabel: string;
  currentOverrideCents: number | null;
  envDefaultCents: number;
  spentCents: number;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ChatCapOverride({
  userId,
  targetLabel,
  currentOverrideCents,
  envDefaultCents,
  spentCents,
}: Props) {
  const router = useRouter();
  // The input shows dollars (operator-friendly), the API takes cents.
  const initialDollars =
    currentOverrideCents !== null
      ? (currentOverrideCents / 100).toFixed(2)
      : "";
  const [valueDollars, setValueDollars] = useState<string>(initialDollars);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveCents = currentOverrideCents ?? envDefaultCents;
  const isOverridden = currentOverrideCents !== null;

  async function submit(overrideCents: number | null) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/chat-cap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrideCents }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSave() {
    const parsed = Number(valueDollars);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive dollar amount, or click Clear to use the default.");
      return;
    }
    const cents = Math.round(parsed * 100);
    submit(cents);
  }

  function handleClear() {
    setValueDollars("");
    submit(null);
  }

  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="space-y-1 min-w-0">
        <div className="font-medium text-sm">Tier-B chatbot monthly cap</div>
        <div className="text-xs text-muted-foreground">
          Override the per-operator monthly cost ceiling for{" "}
          <span className="font-medium">{targetLabel}</span>. Clear to fall
          back to the env default.
        </div>
        <div className="text-xs text-muted-foreground pt-1 space-y-0.5">
          <div>
            Effective cap:{" "}
            <span className="font-medium text-foreground">
              {formatDollars(effectiveCents)}
            </span>
            {isOverridden ? " (override)" : " (env default)"}
          </div>
          <div>
            Env default: <span className="font-medium">{formatDollars(envDefaultCents)}</span>
            {" · "}
            Month-to-date spent:{" "}
            <span className="font-medium">{formatDollars(spentCents)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1">
          <Label htmlFor="chat-cap-override" className="text-xs">
            Override (USD)
          </Label>
          <Input
            id="chat-cap-override"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 25.00"
            value={valueDollars}
            onChange={(e) => setValueDollars(e.target.value)}
            disabled={submitting}
            className="w-28"
          />
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={submitting || valueDollars === ""}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isOverridden ? (
            "Update"
          ) : (
            "Save override"
          )}
        </Button>
        {isOverridden && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={submitting}
          >
            Clear
          </Button>
        )}
      </div>
      {error && (
        <p className="basis-full text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
