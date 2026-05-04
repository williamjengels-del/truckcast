import { redirect } from "next/navigation";

// Legacy path. The Inbox section consolidated 2026-05-03 and direct
// booking requests now live at /dashboard/inbox/direct. Keep this
// redirect so old email links + bookmarks still land on the right
// tab.
export default function LegacyBookingsRedirect() {
  redirect("/dashboard/inbox/direct");
}
