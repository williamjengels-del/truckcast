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
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();
    const tier = profile?.subscription_tier ?? "starter";
    isPro = tier === "pro" || tier === "premium";
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <TrialBanner />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-4 lg:p-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      <FeedbackDialog />
      <WelcomeTour />
      <ChatWidget isPro={isPro} />
    </div>
  );
}
