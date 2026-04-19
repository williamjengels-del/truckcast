import type { Metadata } from "next";
import Link from "next/link";
import { TruckIcon } from "lucide-react";
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
      {/* Nav strip — same pattern as /tools/calculator and /roadmap */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold text-sm">
            <TruckIcon className="h-5 w-5 text-primary" />
            <span className="font-bold">VendCast</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium hover:bg-primary/90 transition-colors"
            >
              Start free trial
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-12 sm:py-16">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Contact us</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Questions, bug reports, feature requests, or billing — we&apos;ll
            get back to you within 1 business day.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <ContactForm />
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Prefer email? Reach us directly at{" "}
          <a
            href="mailto:support@vendcast.co"
            className="text-primary hover:underline"
          >
            support@vendcast.co
          </a>
        </p>
      </main>
    </div>
  );
}
