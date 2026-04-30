import type { Metadata } from "next";

// All dashboard pages require auth and call Supabase — never prerender during build
export const dynamic = "force-dynamic";

import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { TrialBanner } from "@/components/trial-banner";
import { WelcomeTour } from "@/components/welcome-tour";
import { ChatWidget } from "@/components/chat-widget";
import { InstallPrompt } from "@/components/install-prompt";
import {
  ImpersonationProvider,
  type ImpersonationState,
} from "@/components/impersonation-context";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { createClient } from "@/lib/supabase/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

export const metadata: Metadata = {
  title: {
    default: "Dashboard — VendCast",
    template: "%s — VendCast",
  },
  description: "Manage your food truck events, forecasts, and performance analytics.",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isPro = false;
  let isPremium = false;
  let managerBanner: { ownerName: string } | null = null;
  // TODO: Re-enable chat widget when ANTHROPIC_API_KEY is added to Vercel;
  // gated behind Pro/Premium tier. When the env var is absent, the widget
  // does not render at all (prevents client from hitting /api/chat which
  // would 500). Add the key in Vercel → Settings → Environment Variables.
  const chatEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, owner_user_id")
      .eq("id", user.id)
      .single();
    const tier = profile?.subscription_tier ?? "starter";
    isPro = tier === "pro" || tier === "premium";
    isPremium = tier === "premium";

    // If this user is a manager, fetch the owner's business name for the banner
    if (profile?.owner_user_id) {
      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("business_name")
        .eq("id", profile.owner_user_id)
        .single();
      managerBanner = { ownerName: ownerProfile?.business_name ?? "your operator's account" };
    }
  }

  // ── Impersonation context (Commit 5c-i) ──────────────────────────
  // Resolve the dashboard scope once per render and populate the
  // client-side provider so client components (sidebar, nav, etc.)
  // can read the effective user id without round-tripping.
  //
  // 5c-i populates the provider; nothing consumes it yet. Impersonation
  // reads + banner + admin button ship in 5c-ii through 5d.
  //
  // Note: the existing `isPro` / `managerBanner` logic above intentionally
  // stays on the REAL user's profile. Those are admin-posture decisions
  // (chat widget gating, "you're managing X's account" banner for team
  // accounts) — impersonating doesn't make the admin a manager of the
  // target or upgrade their chat tier.
  const scope = await resolveScopedSupabase();
  let impersonationState: ImpersonationState = {
    isImpersonating: false,
    effectiveUserId: scope.kind === "unauthorized" ? null : scope.userId,
    realUserId: scope.kind === "unauthorized" ? null : scope.realUserId,
    targetLabel: null,
    expiresAt: null,
  };
  if (scope.kind === "impersonating") {
    // Look up the target's display label via the service-role client
    // already returned with the scope.
    const [targetProfileRes, targetAuthRes] = await Promise.all([
      scope.client
        .from("profiles")
        .select("business_name")
        .eq("id", scope.userId)
        .maybeSingle(),
      scope.client.auth.admin.getUserById(scope.userId),
    ]);
    const targetBusinessName = (
      targetProfileRes.data as { business_name: string | null } | null
    )?.business_name;
    const targetEmail = targetAuthRes.data?.user?.email;
    impersonationState = {
      isImpersonating: true,
      effectiveUserId: scope.userId,
      realUserId: scope.realUserId,
      targetLabel: targetBusinessName ?? targetEmail ?? scope.userId,
      expiresAt: scope.expiresAt,
    };
  }

  return (
    <ImpersonationProvider value={impersonationState}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        {/* min-w-0 lets this flex column shrink below its content's
            natural width — without it, wide content like the events
            table balloons the column past the viewport (sidebar +
            content > 100vw), and child overflow-x-auto wrappers
            can't trigger because their parent is already as wide
            as their content. */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <Header />
          {/* Impersonation banner renders only when active — mounted
              before Trial / Manager banners so the read-only state is
              the most prominent signal in the chrome. */}
          <ImpersonationBanner />
          <TrialBanner />
          {managerBanner && (
            <div className="shrink-0 bg-brand-teal text-white text-xs text-center py-1.5 px-4 font-medium">
              You&apos;re managing <span className="font-bold">{managerBanner.ownerName}</span>&apos;s account
            </div>
          )}
          <main className="flex-1 overflow-y-auto bg-muted/30 p-4 lg:p-6">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </div>
        <FeedbackDialog />
        <WelcomeTour />
        <ChatWidget isPro={isPro} isPremium={isPremium} enabled={chatEnabled} />
        <InstallPrompt />
      </div>
    </ImpersonationProvider>
  );
}
