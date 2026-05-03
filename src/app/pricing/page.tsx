import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FindVendorLink } from "@/components/find-vendor-link";
import { MarketingFooter } from "@/components/marketing-footer";
import { PricingTiers } from "./pricing-tiers";

export const metadata: Metadata = {
  title: "Pricing — VendCast",
  description:
    "Simple pricing for mobile vendor operators. 14 days free, no credit card required. Built by a food truck operator. For mobile vendors.",
};

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav — matches the homepage so the page reads as part of the
          same site, not a stand-alone landing. Logo + Roadmap +
          Sign in / Get Started. */}
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center" aria-label="VendCast home">
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={400}
              height={140}
              priority
              className="h-10 w-auto"
            />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/roadmap"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Roadmap
            </Link>
            <FindVendorLink />
            <Link href="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="flex-1">
        {/* Hero band — full-bleed teal, matching the homepage's hero
            treatment so /pricing reads as a sibling page, not a
            different aesthetic. Tighter padding because there's no
            CTA pill in this hero — the CTAs live on each tier card. */}
        <div className="bg-brand-teal text-white">
          <div className="container mx-auto px-4 py-12 text-center">
            <h1
              data-testid="pricing-headline"
              className="text-4xl font-bold tracking-tight sm:text-5xl"
            >
              Simple pricing. Built for mobile vendors.
            </h1>
            <p
              data-testid="pricing-subline"
              className="mx-auto mt-6 max-w-2xl text-lg text-white/85"
            >
              Three tiers. Same forecasting engine. Pay monthly or save with
              annual.
            </p>
          </div>
        </div>

        {/* Tier cards + billing toggle (client-rendered for the
            interactive state). */}
        <div className="border-t">
          <div className="container mx-auto max-w-6xl px-4 py-16">
            <PricingTiers />
          </div>
        </div>

        {/* Founder story — per v13 §5, "founder-story slot below tiers."
            Concrete operator origin, not a polished VC-style narrative.
            Worth Julian's pen — current draft kept short and operator-
            language. Easy to swap in PR comments. */}
        <div className="border-t bg-muted/30">
          <div className="container mx-auto max-w-3xl px-4 py-16">
            <div
              data-testid="founder-story"
              className="space-y-4 text-foreground"
            >
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Built by an operator who needed it first.
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                I needed a better way to manage my events. Google Calendar
                didn&apos;t cut it, and nothing on the market was built for
                how we actually operate. So I started building something
                myself.
              </p>
              <p className="text-base leading-relaxed text-muted-foreground">
                It started as scheduling. Then past sales data alongside
                each event. Then automating the data pull so I wasn&apos;t
                inputting it by hand. Then forecasting, once the data was
                clean enough to forecast on. Then weather, after one bad
                year of it killing me without warning.
              </p>
              <p className="text-base leading-relaxed text-muted-foreground">
                A thousand-plus events later, that&apos;s VendCast —
                generalized for any mobile vendor: food truck, trailer,
                cart, pop-up.
              </p>
              <p className="text-base leading-relaxed text-foreground">
                It kept growing because it kept needing to.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom CTA — single button, matches homepage discipline (no
            duplicate "calculate your fees" path). */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-16 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Try VendCast free for 14 days.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              No credit card required.
            </p>
            <div className="mt-6 flex justify-center">
              <Link href="/signup">
                <Button data-testid="pricing-bottom-cta" size="lg">
                  Start free trial
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />

      {/* Mobile sticky CTA — mirrors the homepage's #44 treatment. The
          tier cards above each carry their own CTA, but on mobile the
          operator scrolls past them while reading the founder story
          and bottom CTA; the sticky keeps the action one tap away.
          White pill on brand-teal, hidden at md+. */}
      <div
        data-testid="pricing-mobile-sticky-cta"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-brand-teal px-4 py-3 shadow-lg md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <Link href="/signup" className="block">
          <Button
            data-testid="pricing-mobile-sticky-cta-button"
            size="lg"
            className="w-full rounded-full bg-white font-semibold text-brand-teal shadow-md hover:bg-white/90"
          >
            Start free trial
          </Button>
        </Link>
      </div>
    </div>
  );
}
