import type { Metadata } from "next";

// All dashboard pages require auth and call Supabase — never prerender during build
export const dynamic = "force-dynamic";

import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { TrialBanner } from "@/components/trial-banner";
import { WelcomeTour } from "@/components/welcome-tour";

export const metadata: Metadata = {
  title: {
    default: "Dashboard — VendCast",
    template: "%s — VendCast",
  },
  description: "Manage your food truck events, forecasts, and performance analytics.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    </div>
  );
}
