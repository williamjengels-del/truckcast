"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * /dashboard/team/accept
 * Landing page after a manager clicks their invite email link.
 * Supabase has already exchanged the token and created the session.
 * This page activates the team_members record and sets owner_user_id on the profile.
 */
export default function TeamAcceptPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function activate() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStatus("error");
        setMessage("You must be signed in to accept an invitation. Please check your email link and try again.");
        return;
      }

      // Find a pending invite for this email
      const { data: invite } = await supabase
        .from("team_members")
        .select("id, owner_user_id")
        .eq("member_email", user.email!.toLowerCase())
        .eq("status", "pending")
        .single();

      if (!invite) {
        // Maybe already activated — just go to dashboard
        const { data: profile } = await supabase
          .from("profiles")
          .select("owner_user_id")
          .eq("id", user.id)
          .single();

        if (profile?.owner_user_id) {
          router.replace("/dashboard");
          return;
        }

        setStatus("error");
        setMessage("No pending invitation found for this email address. Contact the account owner to re-send the invite.");
        return;
      }

      // Activate: set member_user_id + status on team_members
      const { error: activateError } = await supabase
        .from("team_members")
        .update({ member_user_id: user.id, status: "active" })
        .eq("id", invite.id);

      if (activateError) {
        setStatus("error");
        setMessage("Failed to activate your invitation. Please try again or contact support.");
        return;
      }

      // Set owner_user_id on the manager's profile
      await supabase
        .from("profiles")
        .update({ owner_user_id: invite.owner_user_id })
        .eq("id", user.id);

      setStatus("success");
      setMessage("You're all set! Redirecting to the dashboard…");
      setTimeout(() => router.replace("/dashboard"), 1500);
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
            <a href="/dashboard" className="text-sm text-primary hover:underline">
              Go to dashboard
            </a>
          </>
        )}
      </div>
    </div>
  );
}
