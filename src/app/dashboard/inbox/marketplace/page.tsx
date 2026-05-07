import { redirect } from "next/navigation";

// Redirect stub kept around 2026-05-07 when the canonical inbox path
// moved from /dashboard/inbox/marketplace → /dashboard/inbox/inquiries.
// The rename was deliberate — VendCast positions against marketplace
// platforms (Food Fleet, Roaming Hunger), so the URL itself shouldn't
// say "marketplace." This stub catches any operator who still has the
// old URL bookmarked or in their email history (every notification
// email sent before the rename pointed here).
//
// Safe to remove once we're confident no live links reference the old
// path — give it a quarter or so before pruning.

export default function MarketplaceInboxRedirect() {
  redirect("/dashboard/inbox/inquiries");
}
