import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { FeedbackDialog } from "@/components/feedback-dialog";

export const metadata: Metadata = {
  title: {
    default: "Dashboard — TruckCast",
    template: "%s — TruckCast",
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
        <main className="flex-1 overflow-y-auto bg-muted/30 p-4 lg:p-6">
          {children}
        </main>
      </div>
      <FeedbackDialog />
    </div>
  );
}
