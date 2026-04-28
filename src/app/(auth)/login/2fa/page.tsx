"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Two-factor login challenge.
//
// Reached when the proxy AAL gate detects a verified factor on a
// password-only (AAL1) session. The user types the 6-digit code from
// their authenticator app; on success the session steps up to AAL2 and
// the dashboard becomes reachable.
//
// Recovery-code path is deliberately NOT in this PR — recovery codes
// ship in their own follow-up. For now, lockout = email support.

export default function TwoFactorChallengePage() {
  const router = useRouter();
  const supabase = createClient();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unenrolling, setUnenrolling] = useState(false);

  useEffect(() => {
    async function loadFactor() {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setError(error.message);
        return;
      }
      const verified = (data?.totp ?? []).find((f) => f.status === "verified");
      if (!verified) {
        // No factor — shouldn't normally land here, but if we do, send
        // back to dashboard (the proxy will re-evaluate).
        router.replace("/dashboard");
        return;
      }
      setFactorId(verified.id);
    }
    loadFactor();
  }, [router, supabase]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setWorking(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });
    if (error) {
      setError(error.message);
      setWorking(false);
      return;
    }
    // Success — proxy will let /dashboard through now that we're AAL2.
    router.replace("/dashboard");
    router.refresh();
  }

  async function handleSignOut() {
    setUnenrolling(true);
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link
            href="/"
            className="mb-2 flex justify-center"
            aria-label="VendCast home"
          >
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={400}
              height={140}
              priority
              className="h-9 w-auto"
            />
          </Link>
          <CardTitle>Two-factor verification</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="totp-challenge-code">Authentication code</Label>
              <Input
                id="totp-challenge-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="text-center tracking-widest text-lg"
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={working || code.length !== 6 || !factorId}
            >
              {working ? "Verifying..." : "Verify"}
            </Button>
          </form>

          <div className="mt-6 space-y-2 text-center">
            <p className="text-xs text-muted-foreground">
              Lost your authenticator? Email{" "}
              <a
                href="mailto:support@vendcast.co"
                className="text-primary hover:underline"
              >
                support@vendcast.co
              </a>{" "}
              — we&apos;ll verify your identity and reset within 1 business
              day.
            </p>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={unenrolling}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {unenrolling ? "Signing out..." : "Sign out and try a different account"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
