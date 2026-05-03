"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * /dashboard/team/accept
 *
 * Landing page after a manager clicks their invite email link.
 * Supabase has already exchanged the token and created the session.
 *
 * Activation logic moved server-side to /api/team/accept (uses
 * service role to bypass team_members RLS that blocks the manager
 * from updating their own pending row, and to atomically link the
 * profile). Previous client-side flow silently failed and left
 * managers with profiles.owner_user_id=NULL.
 */
export default function TeamAcceptPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const router = useRouter();

  useEffect(() => {
    async function activate() {
      try {
        const res = await fetch("/api/team/accept", { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          owner_user_id?: string;
          error?: string;
        };
        if (!res.ok) {
          setStatus("error");
          setMessage(body.error ?? "Failed to activate invitation.");
          return;
        }
        setStatus("success");
        setMessage("You're all set! Redirecting to the dashboard…");
        setTimeout(() => router.replace("/dashboard"), 1500);
      } catch (e) {
        setStatus("error");
        setMessage(
          e instanceof Error
            ? e.message
            : "Network error while activating your invitation."
        );
      }
    }
    activate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        {status === "loading" && (
          <>
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground">Activating your invitation…</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="text-4xl">✓</div>
            <p className="text-green-700 font-medium">{message}</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-4xl">✗</div>
            <p className="text-destructive">{message}</p>
            <Link href="/dashboard" className="text-sm text-primary hover:underline">
              Go to dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
