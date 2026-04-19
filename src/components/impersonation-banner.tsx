"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Eye, Loader2 } from "lucide-react";
import { useImpersonation } from "@/components/impersonation-context";

// Persistent banner shown at the top of every /dashboard/* page when
// an admin is actively impersonating another user.
//
// Hidden when useImpersonation().isImpersonating is false, so safe to
// mount unconditionally in the dashboard layout. The context provider
// there (populated from the server-side scope resolve) controls
// visibility.
//
// Mounts high in the visual stack with a distinctive rose color so
// "you're viewing someone else's data in read-only mode" is obvious
// without needing to read the text carefully. Mutations are blocked
// by the Commit 5b proxy regardless, so the banner is informational —
// it tells the admin WHY their writes keep failing, not what gates
// the write itself.

function formatRemaining(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes >= 1) return `${minutes} min remaining`;
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${seconds}s remaining`;
}

export function ImpersonationBanner() {
  const { isImpersonating, targetLabel, effectiveUserId, expiresAt } =
    useImpersonation();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [exiting, setExiting] = useState(false);

  // Live-update "N min remaining". Tick every 30s — cheap, enough
  // precision for a 30-minute session.
  useEffect(() => {
    if (!isImpersonating || !expiresAt) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [isImpersonating, expiresAt]);

  if (!isImpersonating || !targetLabel) return null;

  const targetForReturn = effectiveUserId;

  async function handleExit() {
    setExiting(true);
    try {
      await fetch("/api/admin/impersonate/stop", { method: "POST" });
    } catch {
      // Even on network error, the cookie may be cleared — let the
      // refresh below settle the UI truthfully.
    }
    // Land back on the user detail page the admin started from, so
    // they can keep working on the same target (e.g. adjust tier,
    // import more events). Capture targetForReturn BEFORE refresh
    // because context will flip to isImpersonating=false afterward.
    if (targetForReturn) {
      router.push(`/dashboard/admin/users/${targetForReturn}`);
    }
    router.refresh();
  }

  return (
    <div
      role="status"
      className="shrink-0 bg-rose-600 text-white px-4 py-2 flex items-center justify-between gap-3 flex-wrap text-sm font-medium"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Viewing as <span className="font-bold">{targetLabel}</span> — read only
        </span>
        {expiresAt && (
          <span className="text-rose-100 text-xs ml-1 shrink-0">
            · {formatRemaining(expiresAt, now)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={handleExit}
        disabled={exiting}
        className="inline-flex items-center gap-1 rounded bg-white/15 hover:bg-white/25 disabled:opacity-60 px-2 py-1 text-xs font-semibold transition-colors"
      >
        {exiting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Exiting…
          </>
        ) : (
          <>
            <X className="h-3.5 w-3.5" />
            Exit impersonation
          </>
        )}
      </button>
    </div>
  );
}
