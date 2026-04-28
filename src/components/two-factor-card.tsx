"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Two-factor authentication card on /dashboard/settings.
//
// Three states:
//   - "loading"    — initial factor lookup
//   - "disabled"   — no verified factor; offers Enable button
//   - "enrolling"  — factor created (unverified); shows QR + 6-digit verify
//   - "enabled"    — verified factor exists; offers Disable button
//
// Recovery codes UI is deliberately NOT in this PR — recovery codes ship
// in their own follow-up so the Supabase MFA primitives can land first
// without being bottlenecked on the recovery-code DB schema.

type FactorStatus = "loading" | "disabled" | "enrolling" | "enabled";

interface PendingFactor {
  id: string;
  qrCode: string;
  secret: string;
  uri: string;
}

export function TwoFactorCard() {
  const supabase = createClient();
  const [status, setStatus] = useState<FactorStatus>("loading");
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFactor | null>(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setError(error.message);
      setStatus("disabled");
      return;
    }
    const verified = (data?.totp ?? []).find((f) => f.status === "verified");
    if (verified) {
      setVerifiedFactorId(verified.id);
      setStatus("enabled");
    } else {
      setVerifiedFactorId(null);
      setStatus("disabled");
    }
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable() {
    setWorking(true);
    setError(null);
    try {
      // Clean up any stale unverified factors first — Supabase doesn't
      // auto-expire them, and starting a new enroll while one is
      // unverified throws.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.totp ?? []) {
        if (f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `vendcast-${new Date().toISOString().slice(0, 10)}`,
      });
      if (error || !data) {
        throw new Error(error?.message ?? "Enrollment failed");
      }
      setPending({
        id: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
      setStatus("enrolling");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    }
    setWorking(false);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setWorking(true);
    setError(null);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: pending.id,
        code: code.trim(),
      });
      if (error) throw new Error(error.message);
      setPending(null);
      setCode("");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    }
    setWorking(false);
  }

  async function handleCancelEnroll() {
    if (!pending) return;
    setWorking(true);
    setError(null);
    try {
      await supabase.auth.mfa.unenroll({ factorId: pending.id });
      setPending(null);
      setCode("");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
    setWorking(false);
  }

  async function handleDisable() {
    if (!verifiedFactorId) return;
    if (
      !confirm(
        "Disable two-factor authentication? You'll sign in with just your password until you re-enable it."
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: verifiedFactorId,
      });
      if (error) throw new Error(error.message);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disable failed");
    }
    setWorking(false);
  }

  return (
    <Card className="max-w-2xl" id="security">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status === "enabled" ? (
            <ShieldCheck className="h-5 w-5 text-brand-teal" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          )}
          Two-Factor Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "loading" && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}

        {status === "disabled" && (
          <>
            <p className="text-sm text-muted-foreground">
              Add a second step at sign-in using an authenticator app
              (Google Authenticator, 1Password, Authy). Strongly recommended
              if your account holds POS or banking integrations.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={handleEnable}
              disabled={working}
            >
              {working ? "Starting..." : "Enable two-factor authentication"}
            </Button>
          </>
        )}

        {status === "enrolling" && pending && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app, or enter the
              setup key manually.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {/* Supabase returns qr_code as an SVG data URI — render via
                  next/image so the build pipeline doesn't choke on raw
                  inline SVG, while still letting the contents render. */}
              <Image
                src={pending.qrCode}
                alt="Two-factor authentication QR code"
                width={200}
                height={200}
                unoptimized
                className="border rounded"
              />
              <div className="space-y-2 flex-1">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Setup key (manual entry)
                </Label>
                <code className="text-sm bg-muted p-2 rounded block break-all">
                  {pending.secret}
                </code>
              </div>
            </div>
            <form onSubmit={handleVerify} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="totp-verify-code">Enter the 6-digit code</Label>
                <Input
                  id="totp-verify-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="max-w-[8rem]"
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={working || code.length !== 6}
                >
                  {working ? "Verifying..." : "Verify and enable"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEnroll}
                  disabled={working}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {status === "enabled" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Two-factor authentication is enabled. You&apos;ll be asked
              for a 6-digit code from your authenticator app each time you
              sign in.
            </p>
            <p className="text-sm text-muted-foreground">
              Lost your authenticator and recovery codes? Email{" "}
              <a
                href="mailto:support@vendcast.co"
                className="text-primary hover:underline"
              >
                support@vendcast.co
              </a>{" "}
              — we&apos;ll verify your identity and reset within 1 business
              day.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDisable}
              disabled={working}
              className="text-destructive hover:text-destructive"
            >
              {working ? "Working..." : "Disable two-factor authentication"}
            </Button>
          </div>
        )}

        {error && status !== "enrolling" && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
