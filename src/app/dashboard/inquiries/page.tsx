import { redirect } from "next/navigation";

// Legacy path. The Inbox section consolidated 2026-05-03; the
// marketplace -> inquiries rename happened 2026-05-07. Inquiries
// now live at /dashboard/inbox/inquiries. Keep this redirect for
// old email links + bookmarks. (A separate redirect stub at
// /dashboard/inbox/marketplace covers the intermediate-era links.)
export default function LegacyInquiriesRedirect() {
  redirect("/dashboard/inbox/inquiries");
}
