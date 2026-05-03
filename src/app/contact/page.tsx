import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FindVendorLink } from "@/components/find-vendor-link";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact — VendCast",
  description:
    "Reach the VendCast team. Questions, bug reports, feature requests, or billing — we'll get back to you within 1 business day.",
};

// Public contact page — no auth wall. Matches the signup / login
// aesthetic (max-w-lg card on a muted background). The interactive
// form is a client component (./contact-form.tsx); this wrapper only
// supplies metadata + layout.

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-muted/30">
      {/* Nav — Phase 2 brand swap: TruckIcon + text → real wordmark
          image, matches homepage / pricing / roadmap. */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center" aria-label="VendCast home">
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={400}
              height={140}
              className="h-9 w-auto"
            />
          </Link>
          <div className="flex items-center gap-3">
            <FindVendorLink />
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link href="/signup">
              <Button size="sm">Start free trial</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero band — full-bleed teal to match the homepage / pricing /
          roadmap surfaces. Page-specific because the form below sits in
          a tight max-w-lg card; the band gives the page brand presence
          without crowding the form. */}
      <div className="bg-brand-teal text-white">
        <div className="max-w-4xl mx-auto px-4 py-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Contact us
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-white/85">
            Questions, bug reports, feature requests, or billing — we&apos;ll
            get back to you within 1 business day.
          </p>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-12 sm:py-16">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <ContactForm />
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Prefer email? Reach us directly at{" "}
          <a
            href="mailto:support@vendcast.co"
            className="text-brand-teal hover:underline"
          >
            support@vendcast.co
          </a>
        </p>
      </main>
    </div>
  );
}
