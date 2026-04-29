"use client";

import { useState } from "react";
import { ShieldOff, Loader2, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// Admin-only "Reset 2FA" trigger. Calls
// /api/admin/users/[userId]/mfa-reset which deletes the target user's
// TOTP factor + recovery codes via service role and writes an
// admin_actions audit row. Use case: support email comes in saying
// "I lost my authenticator AND my recovery codes," admin verifies
// identity out-of-band, hits this button.

interface Props {
  userId: string;
  targetLabel: string;
}

export function MfaResetButton({ userId, targetLabel }: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    factors_deleted: number;
    recovery_codes_deleted: number;
  } | null>(null);

  async function handleReset() {
    if (
      !confirm(
        `Reset 2FA for ${targetLabel}? Their authenticator factor and recovery codes will be deleted. They'll be able to sign in with just their password until they re-enroll.`
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/mfa-reset`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Reset failed (HTTP ${res.status})`);
        setWorking(false);
        return;
      }
      setResult({
        factors_deleted: body.factors_deleted ?? 0,
        recovery_codes_deleted: body.recovery_codes_deleted ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
    setWorking(false);
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleReset}
        disabled={working}
      >
        {working ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Resetting...
          </>
        ) : (
          <>
            <ShieldOff className="h-4 w-4 mr-2" /> Reset 2FA
          </>
        )}
      </Button>
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
      {result && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
          <Check className="h-3 w-3" /> Reset — {result.factors_deleted} factor
          {result.factors_deleted === 1 ? "" : "s"} +{" "}
          {result.recovery_codes_deleted} recovery code
          {result.recovery_codes_deleted === 1 ? "" : "s"} cleared.
        </p>
      )}
    </div>
  );
}
