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
import { createClient } from "@/lib/supabase/server";

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <TrialBanner />
        {managerBanner && (
          <div className="shrink-0 bg-violet-600 text-white text-xs text-center py-1.5 px-4 font-medium">
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
      <ChatWidget isPro={isPro} enabled={chatEnabled} />
      <InstallPrompt />
    </div>
  );
}
