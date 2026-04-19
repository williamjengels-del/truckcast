"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Client-side trigger for admin impersonation. Posts to the start
// endpoint from Commit 5a, then navigates to /dashboard where the
// banner (5d) and the scope-aware reads (5c-ii through 5c-iv) take
// over. Self-impersonation is rejected server-side (admin.id ===
// userId returns 400) — the admin detail page doesn't bother
// pre-filtering that case; we surface whatever error comes back.

interface Props {
  userId: string;
  targetLabel: string;
}

export function ImpersonateButton({ userId, targetLabel }: Props) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Start failed (HTTP ${res.status})`);
        setStarting(false);
        return;
      }
      // Cookie is now set. Navigating to /dashboard triggers a full
      // server render with the impersonation-aware scope active.
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setStarting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="font-medium text-sm">View dashboard as this user</div>
        <div className="text-xs text-muted-foreground">
          Read-only impersonation — writes are blocked. 30-minute session,
          logged to audit as <code className="font-mono text-xs bg-muted px-1 rounded">user.impersonate_start</code>.
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
        onClick={handleStart}
        disabled={starting}
      >
        {starting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <Eye className="h-4 w-4 mr-2" />
            View as {targetLabel}
          </>
        )}
      </Button>
    </div>
  );
}
