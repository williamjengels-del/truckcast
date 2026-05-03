import type { Metadata } from "next";
import { RequestEventForm } from "@/components/request-event-form";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Request a Mobile Vendor — VendCast",
  description:
    "Need a food truck or mobile vendor for your event? Submit one form, reach operators in your area directly. No commission, no middleman — operators respond to you directly.",
  openGraph: {
    title: "Find a food truck for your event",
    description:
      "Submit one form. Operators in your area reach out directly. No commission, no markup — you pay the vendor directly.",
    url: "https://vendcast.co/request-event",
    siteName: "VendCast",
    type: "website",
  },
};

export default function RequestEventPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav (mirrors marketing pages). No "Find a vendor" link
          here — the user is already on it. The "I'm an operator"
          button on the right disambiguates audience for anyone who
          arrived from a vendor's link. */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={120}
              height={32}
              className="h-8 w-auto"
              priority
            />
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/help" className="text-sm hover:text-brand-teal hidden sm:inline-block px-3 py-2">
              Help
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">I&apos;m an operator</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero — full-bleed teal band so the page reads as a sibling
          of the homepage / pricing surfaces, not a stand-alone form
          dump. Matches the visual language organizers expect when
          they land via SEO or the "Find a vendor" nav link. */}
      <div className="bg-brand-teal text-white">
        <div className="container mx-auto px-4 py-12 text-center max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/80 mb-3">
            For event organizers
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
            Looking for a food truck for your event?
          </h1>
          <p className="text-base sm:text-lg text-white/90 mt-4 max-w-2xl mx-auto">
            Submit one form. Operators in your area reach out directly.{" "}
            <strong className="text-white">No commission, no middleman.</strong>{" "}
            You negotiate menu, pricing, and logistics with the vendor — VendCast doesn&apos;t take a cut.
          </p>
        </div>
      </div>

      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          {/* Process explainer ABOVE the form so organizers see what
              actually happens before deciding to commit their info.
              Trust-signal copy (per brainstorm): generic positioning,
              process clarity, zero-commission framing. No operator
              names, logos, or counts. */}
          <div className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div className="rounded-lg border p-5">
              <p className="text-2xl font-bold text-brand-teal">1.</p>
              <p className="font-medium mt-1">Submit one form</p>
              <p className="text-xs text-muted-foreground mt-1">
                Tell us your event date, location, and what you&apos;re looking for. Two minutes.
              </p>
            </div>
            <div className="rounded-lg border p-5">
              <p className="text-2xl font-bold text-brand-teal">2.</p>
              <p className="font-medium mt-1">Operators respond directly</p>
              <p className="text-xs text-muted-foreground mt-1">
                Matching vendors in your city reach out via the email you provide. Usually within 48 hours.
              </p>
            </div>
            <div className="rounded-lg border p-5">
              <p className="text-2xl font-bold text-brand-teal">3.</p>
              <p className="font-medium mt-1">Pick + book the one you like</p>
              <p className="text-xs text-muted-foreground mt-1">
                You negotiate the deal directly with the operator. VendCast doesn&apos;t take a cut.
              </p>
            </div>
          </div>

          {/* Free / no-account trust line right above the form to
              soften commitment friction. */}
          <p className="text-center text-sm text-muted-foreground mb-4">
            Free. No account required. No vendor markup.
          </p>

          <RequestEventForm />
        </div>
      </main>

      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <Link href="/" className="hover:text-brand-teal">VendCast</Link>
          {" · "}
          <Link href="/pricing" className="hover:text-brand-teal">For operators</Link>
          {" · "}
          <Link href="/changelog" className="hover:text-brand-teal">Changelog</Link>
          {" · "}
          <Link href="/help" className="hover:text-brand-teal">Help</Link>
        </div>
      </footer>
    </div>
  );
}
