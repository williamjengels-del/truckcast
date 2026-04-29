"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Two-factor authentication card on /dashboard/settings.
//
// States:
//   - "loading"          — initial factor lookup
//   - "disabled"         — no verified factor; offers Enable button
//   - "enrolling"        — factor created (unverified); shows QR + 6-digit verify
//   - "showing-codes"    — TOTP just verified; show single-display recovery codes
//   - "enabled"          — verified factor + codes saved; offers Disable / Regenerate

type FactorStatus =
  | "loading"
  | "disabled"
  | "enrolling"
  | "showing-codes"
  | "enabled";

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
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesAcked, setRecoveryCodesAcked] = useState(false);
  const [copied, setCopied] = useState(false);
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

  async function generateRecoveryCodes(): Promise<string[]> {
    const res = await fetch("/api/auth/mfa/recovery-codes/generate", {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to generate recovery codes");
    }
    return (data.codes ?? []) as string[];
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

      // TOTP is verified. Generate recovery codes immediately so the
      // operator can save them in the same flow. The session is now
      // AAL2 (we just completed a challenge), so the generate
      // endpoint accepts.
      const codes = await generateRecoveryCodes();

      setPending(null);
      setCode("");
      setRecoveryCodes(codes);
      setRecoveryCodesAcked(false);
      setStatus("showing-codes");
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

  function handleCopyCodes() {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadCodes() {
    const blob = new Blob(
      [
        `VendCast — Two-Factor Recovery Codes\n` +
          `Generated: ${new Date().toISOString().slice(0, 10)}\n\n` +
          `Each code may be used once to recover access if you lose your\n` +
          `authenticator app. Using a code disables 2FA — re-enroll afterward.\n\n` +
          recoveryCodes.join("\n") +
          `\n`,
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vendcast-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAckCodes() {
    setRecoveryCodes([]);
    setRecoveryCodesAcked(true);
    await refreshStatus();
  }

  async function handleRegenerateCodes() {
    if (
      !confirm(
        "Generate new recovery codes? Your existing codes will become invalid."
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const codes = await generateRecoveryCodes();
      setRecoveryCodes(codes);
      setRecoveryCodesAcked(false);
      setStatus("showing-codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regenerate failed");
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
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: verifiedFactorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Disable failed");
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

        {status === "showing-codes" && (
          <div className="space-y-4">
            <div className="rounded-md border-2 border-brand-orange/50 bg-brand-orange/5 p-4 space-y-3">
              <p className="text-sm font-medium">
                Save these recovery codes now.
              </p>
              <p className="text-sm text-muted-foreground">
                Each code can be used once to recover access if you lose your
                authenticator app. Using a code disables 2FA — you&apos;ll
                re-enroll afterward. <strong>You won&apos;t see these
                again.</strong>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 font-mono text-sm">
                {recoveryCodes.map((c) => (
                  <code
                    key={c}
                    className="bg-background border rounded px-2 py-1.5 text-center select-all"
                  >
                    {c}
                  </code>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCodes}
                  className="gap-1.5"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy all
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCodes}
                >
                  Download .txt
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={recoveryCodesAcked}
                  onChange={(e) => setRecoveryCodesAcked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I&apos;ve saved my recovery codes somewhere safe.
                </span>
              </label>
              <Button
                type="button"
                size="sm"
                onClick={handleAckCodes}
                disabled={!recoveryCodesAcked}
              >
                Continue
              </Button>
            </div>
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRegenerateCodes}
                disabled={working}
              >
                {working ? "Working..." : "Generate new recovery codes"}
              </Button>
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
          </div>
        )}

        {error && status !== "enrolling" && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
