import type { Metadata } from "next";
import { InboxTabBar } from "./inbox-tab-bar";

export const metadata: Metadata = { title: "Inbox" };

// Inbox section layout. Renders the page header + tab bar above
// every sub-route (`direct`, `marketplace`). Tabs are sub-routes (not
// query params) so the URL bar tells the operator where they are and
// deep-links work cleanly across reloads.
export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="text-muted-foreground text-sm">
          Incoming bookings and event inquiries — triage in one place.
        </p>
      </div>
      <InboxTabBar />
      <div>{children}</div>
    </div>
  );
}
