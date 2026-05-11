"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// In-app change-password card on /dashboard/settings (Security tab).
// Sibling to the unauthenticated reset-password flow at /reset-password
// — that's for "I forgot it"; this is for "I remember it, want to rotate
// it without losing my session."
//
// Verification of the current password uses signInWithPassword against
// the session's email. Supabase doesn't expose a "verify-only" primitive
// for passwords; a successful signInWithPassword with matching email
// just refreshes the existing session, no harm done. Failure surfaces
// as a clear "Current password didn't match" without leaking other
// state.
//
// Updating the password keeps the user signed in (Supabase's
// updateUser flow). They don't get bounced to /login, which is the
// whole reason this card exists rather than redirecting to the
// recovery flow.

export function ChangePasswordCard() {
  const supabase = createClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    if (next === current) {
      setError("New password must differ from your current password.");
      return;
    }

    setWorking(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      setError(
        "Couldn't read your email from the session. Sign out and back in, then try again."
      );
      setWorking(false);
      return;
    }

    // Verify current password by attempting to sign in with it. On match
    // the existing session is refreshed (no side-effects); on mismatch
    // Supabase returns an auth error which we surface generically so we
    // don't leak whether the email exists or whether MFA is required.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (verifyError) {
      setError("Current password didn't match.");
      setWorking(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: next,
    });
    if (updateError) {
      setError(updateError.message);
      setWorking(false);
      return;
    }

    setSuccess(true);
    setCurrent("");
    setNext("");
    setConfirm("");
    setWorking(false);
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          Change password
        </CardTitle>
        <CardDescription>
          Pick something you haven&apos;t used before — at least 8 characters.
          You&apos;ll stay signed in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <p className="text-sm text-primary">
              Password updated. You&apos;re still signed in.
            </p>
          )}
          <Button type="submit" disabled={working}>
            {working ? "Updating..." : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
