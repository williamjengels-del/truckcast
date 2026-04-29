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
// Two paths:
//   - "totp"     — 6-digit code from the authenticator app (default)
//   - "recovery" — single-use recovery code; consumes the code and
//     unenrolls TOTP, then redirects the operator to settings to
//     re-enroll. This is the only operator-self-service way out of
//     "lost my authenticator app." Without a recovery code, lockout
//     means emailing support@vendcast.co.

type Mode = "totp" | "recovery";

export default function TwoFactorChallengePage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("totp");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    async function loadFactor() {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setError(error.message);
        return;
      }
      const verified = (data?.totp ?? []).find((f) => f.status === "verified");
      if (!verified) {
        router.replace("/dashboard");
        return;
      }
      setFactorId(verified.id);
    }
    loadFactor();
  }, [router, supabase]);

  async function handleVerifyTotp(e: React.FormEvent) {
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
    router.replace("/dashboard");
    router.refresh();
  }

  async function handleVerifyRecovery(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    setError(null);
    const res = await fetch("/api/auth/mfa/recovery-codes/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: recoveryCode.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Recovery code verification failed");
      setWorking(false);
      return;
    }
    // Factor was deleted server-side. Refresh the session so the proxy
    // AAL gate sees no enrolled factor on the next request.
    await supabase.auth.refreshSession();
    router.replace("/dashboard/settings?recovered=1#security");
    router.refresh();
  }

  async function handleSignOut() {
    setSigningOut(true);
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
          <CardTitle>
            {mode === "totp" ? "Two-factor verification" : "Use a recovery code"}
          </CardTitle>
          <CardDescription>
            {mode === "totp"
              ? "Enter the 6-digit code from your authenticator app"
              : "Enter one of your saved recovery codes — using it will disable 2FA so you can re-enroll."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "totp" ? (
            <form onSubmit={handleVerifyTotp} className="space-y-4">
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
          ) : (
            <form onSubmit={handleVerifyRecovery} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recovery-challenge-code">Recovery code</Label>
                <Input
                  id="recovery-challenge-code"
                  type="text"
                  autoComplete="off"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="ABCDE-23456"
                  className="text-center tracking-widest text-lg uppercase"
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Hyphens optional. Using a code consumes it and disables
                  2FA — you&apos;ll be asked to re-enroll right after.
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={working || recoveryCode.trim().length < 10}
              >
                {working ? "Verifying..." : "Use recovery code"}
              </Button>
            </form>
          )}

          <div className="mt-6 space-y-2 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "totp" ? "recovery" : "totp");
                setError(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline block w-full"
            >
              {mode === "totp"
                ? "Use a recovery code instead"
                : "Back to authenticator code"}
            </button>
            <p className="text-xs text-muted-foreground pt-2">
              Lost both? Email{" "}
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
              disabled={signingOut}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {signingOut ? "Signing out..." : "Sign out and try a different account"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
