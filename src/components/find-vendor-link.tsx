import Link from "next/link";

/**
 * Marketing nav link to /request-event for event organizers.
 *
 * Visually distinct (teal-outlined pill) so an organizer scanning
 * the nav doesn't have to read each item to find the path that's
 * for them, but tasteful enough not to compete with the operator-
 * facing CTAs ("Sign in" / "Get Started"). Per Verdict #25, teal =
 * default brand presence; orange is reserved for differentiator /
 * closer accents and would shout too loud in nav.
 *
 * Visible at every viewport — operator search traffic is mostly
 * mobile, so the link must NOT hide behind a hamburger.
 *
 * Used across the marketing surfaces (homepage, pricing, roadmap,
 * changelog, contact, help, status, calculator, signup). Centralizing
 * the styling here means the next nav-language tweak is a one-file
 * edit instead of 9.
 */
export function FindVendorLink() {
  return (
    <Link
      href="/request-event"
      className="inline-flex items-center gap-1.5 rounded-md border border-brand-teal/40 bg-brand-teal/5 px-3 py-1.5 text-sm font-medium text-brand-teal transition-colors hover:bg-brand-teal/10"
    >
      Find a vendor
    </Link>
  );
}
