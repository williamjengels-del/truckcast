"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
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

export default function ResetPasswordConfirmPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState<"loading" | "ok" | "missing">(
    "loading"
  );
  const router = useRouter();
  const supabase = createClient();

  // The user arrived here after Supabase exchanged the recovery code
  // in /auth/callback. If they navigated here directly without that
  // flow there's no session and we show an error rather than letting
  // them attempt an updateUser call that will fail with a confusing
  // 401.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(data.session ? "ok" : "missing");
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    // Successful password change. The recovery session may still be
    // AAL1 — if the user has TOTP enrolled, the dashboard middleware
    // will bounce them to /login/2fa for the challenge. That's the
    // correct security posture: password reset alone shouldn't bypass
    // the second factor.
    router.push("/dashboard");
    router.refresh();
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
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>
            {sessionReady === "missing"
              ? "This reset link is no longer valid."
              : "Pick something you haven't used before — at least 8 characters."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionReady === "loading" && (
            <p className="text-sm text-muted-foreground text-center">
              Loading...
            </p>
          )}

          {sessionReady === "missing" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Reset links expire after 1 hour and can only be used once.
                Request a new one and try again.
              </p>
              <Link href="/reset-password" className="block">
                <Button className="w-full">Send a new reset link</Button>
              </Link>
              <Link href="/login" className="block">
                <Button variant="outline" className="w-full">
                  Back to sign in
                </Button>
              </Link>
            </div>
          )}

          {sessionReady === "ok" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Updating..." : "Save new password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
