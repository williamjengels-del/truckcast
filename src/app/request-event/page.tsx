import type { Metadata } from "next";
import { RequestEventForm } from "@/components/request-event-form";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Request a Mobile Vendor — VendCast",
  description: "Need a food truck or mobile vendor for your event? Submit one form, reach operators in your area directly. No commission, no middleman — operators respond to you directly.",
};

export default function RequestEventPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav (mirrors marketing pages) */}
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

      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-teal mb-3">
              For event organizers
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Looking for a mobile vendor?
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              Submit one form. Operators in your area will reach out directly. <strong className="text-foreground">No commission, no middleman.</strong> You negotiate everything — menu, pricing, logistics — with the operator.
            </p>
          </div>

          <RequestEventForm />

          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
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
