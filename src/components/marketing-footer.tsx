import Link from "next/link";

/**
 * Shared footer for every public marketing surface.
 *
 * Pre-extraction the site had 5 different footer shapes across
 * marketing pages — full link group on homepage, abbreviated dot-list
 * on changelog/status/request-event, a sparse "Back to home" on help,
 * a 2-link group on pricing. Operators noticed; cleanup pass 2026-05-03.
 *
 * Centralizing here means the next nav-language tweak is a one-file
 * edit and a missed page can never drift again.
 *
 * NOT used on:
 *   - /privacy and /terms — legal pages keep their compact cross-
 *     reference footer (Privacy ↔ Terms ↔ Help ↔ Home).
 *   - dashboard surfaces — they have the sidebar instead.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t py-8 mt-12">
      <div className="container mx-auto px-4 text-center text-sm text-muted-foreground space-y-2">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/pricing" className="hover:text-foreground transition-colors">
            Pricing
          </Link>
          <Link href="/roadmap" className="hover:text-foreground transition-colors">
            Roadmap
          </Link>
          <Link href="/changelog" className="hover:text-foreground transition-colors">
            Changelog
          </Link>
          <Link href="/help" className="hover:text-foreground transition-colors">
            Help Center
          </Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">
            Contact
          </Link>
          <Link href="/request-event" className="hover:text-foreground transition-colors">
            Need a vendor?
          </Link>
          <Link href="/signup" className="hover:text-foreground transition-colors">
            Get Started
          </Link>
        </div>
        <p>
          &copy; {new Date().getFullYear()} VendCast — built by a food truck
          operator, for mobile vendors.
        </p>
      </div>
    </footer>
  );
}
