import { redirect } from "next/navigation";

// Legacy path. The Inbox section consolidated 2026-05-03 and
// marketplace inquiries now live at /dashboard/inbox/marketplace.
// Keep this redirect so old email links + bookmarks still land on
// the right tab.
export default function LegacyInquiriesRedirect() {
  redirect("/dashboard/inbox/marketplace");
}
