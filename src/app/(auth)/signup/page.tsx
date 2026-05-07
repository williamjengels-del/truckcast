"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Plan/billing pickup from /pricing CTAs. The /pricing page links to
 * /signup?plan=<tier>&billing=<period> when an operator clicks a tier
 * card. We persist `intended_tier` so /dashboard/settings can
 * pre-highlight the matching tier on day-2.
 *
 * The trial itself is plan-agnostic — every signup gets 14 days free
 * regardless of which tier they clicked. Stripe checkout happens
 * later via /dashboard/settings.
 */
const VALID_PLANS = {
  starter: "Starter",
  pro: "Pro",
  premium: "Premium",
} as const;
type ValidPlan = keyof typeof VALID_PLANS;

const VALID_BILLING = {
  monthly: "monthly",
  annual: "annual",
} as const;
type ValidBilling = keyof typeof VALID_BILLING;

function isValidPlan(s: string | null): s is ValidPlan {
  return s !== null && Object.prototype.hasOwnProperty.call(VALID_PLANS, s);
}
function isValidBilling(s: string | null): s is ValidBilling {
  return s !== null && Object.prototype.hasOwnProperty.call(VALID_BILLING, s);
}

/**
 * Email + password signup. Slimmed 2026-05-07 from a 4-field form
 * (business name, state, email, password) to email + password only.
 *
 * Why: business name + state were duplicating onboarding step 1,
 * which collects them again. Removing the duplicate at the conversion
 * moment trades a little post-signup friction for a clearer "just
 * sign up" path. Welcome email migrated to fire after onboarding
 * step 1 (where business name is captured), so it's still personalized.
 */
export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan");
  const billingParam = searchParams.get("billing");
  const intendedPlan = isValidPlan(planParam) ? planParam : null;
  const intendedBilling = isValidBilling(billingParam) ? billingParam : null;

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Upsert profile — ensures row exists even if the DB trigger
    // didn't fire. business_name, city, state, timezone are collected
    // in onboarding step 1, not here.
    //
    // intended_tier persists the /pricing → /signup plan choice so
    // /dashboard/settings can pre-highlight the matching tier on
    // day-2. Only written when the URL carried a valid plan param;
    // direct signups carry no intent and the column stays null.
    if (data.user) {
      await supabase
        .from("profiles")
        .upsert(
          {
            id: data.user.id,
            subscription_tier: "starter",
            ...(intendedPlan ? { intended_tier: intendedPlan } : {}),
          },
          { onConflict: "id" }
        );
    }

    // Welcome email fires from onboarding step 1 (post-business-name
    // capture) so the personalization still works.

    // If email confirmation is enabled
    if (data.user && !data.session) {
      setSuccess(true);
    } else {
      router.push("/dashboard");
      router.refresh();
    }

    setLoading(false);
  }

  async function handleGoogleSignup() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setError(error.message);
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to <strong>{email}</strong>. Click the
              link to activate your account.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
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
          <CardTitle>Start your free trial</CardTitle>
          <CardDescription>
            14 days free, no credit card required
          </CardDescription>
        </CardHeader>
        <CardContent>
          {intendedPlan && (
            <div
              data-testid="signup-intended-plan-banner"
              className="mb-6 rounded-md border border-brand-teal/30 bg-brand-teal/5 px-4 py-3 text-sm"
            >
              <p className="font-medium text-foreground">
                You&apos;re starting with VendCast {VALID_PLANS[intendedPlan]}
                {intendedBilling ? ` (${intendedBilling})` : ""}.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                14 days free first — billing setup happens after the trial,
                from your dashboard.
              </p>
            </div>
          )}
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account..." : "Start free trial"}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignup}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </Button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
            , including the use of your event data for internal forecast improvement (opt-out available in Settings).
          </p>

          <p className="mt-3 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
