import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { FindVendorLink } from "@/components/find-vendor-link";
import { MarketingFooter } from "@/components/marketing-footer";
import { RoiCalculator } from "@/components/roi-calculator";
import {
  WEATHER_LOSS_PER_EVENT,
  WEATHER_LOSS_LAST_REVIEWED,
} from "@/lib/homepage-stats";
import { ArrowRight } from "lucide-react";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "VendCast — The operating system for mobile vendors",
  description:
    "Inquiries, bookings, calendar, sales, and forecasts — in one place. Built by a food truck operator. For mobile vendors.",
};

function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function getEventCount(): Promise<number> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return 1983;
  }
  try {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const query = serviceClient
      .from("events")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => count ?? 1983);
    return await withTimeout(query, 3000, 1983);
  } catch {
    return 1983;
  }
}

const EMPHASIS_RESOLVED = "text-4xl font-bold text-brand-teal";

function formatLastReviewed(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// "See what operators see" — Phase 2.5 lower-feature-section per the
// v33 brief direction. Replaces the prior 5-card generic feature grid
// with three tightly-cropped product screenshots that each carry a
// one-line caption explaining what the surface does.
//
// Image files land at /public/marketing/screenshots/<file>.png, captured
// via scripts/capture-screenshots.mjs against the demo operator account
// (vendcast.co/<demo-slug>) so prospects see a credible-but-clean
// version of the product without any real operator's branding.
//
// Placeholder treatment: until the capture script runs, each card
// renders a brand-teal-tinted dashed-border block with the surface
// label. The card structure (caption, framing, hover) is identical
// to the live treatment — when real PNGs land, the only diff is
// swapping the placeholder body for <Image src=...>.
const PRODUCT_SCREENS = [
  {
    src: "/marketing/screenshots/todays-event.png",
    alt: "Today's event card on the dashboard with weather, contact, and sales pace.",
    title: "Today's Event",
    caption: "Open it in the morning. Run the day from this screen.",
  },
  {
    src: "/marketing/screenshots/inquiry-inbox.png",
    alt: "Inquiry inbox showing several event requests with engagement signals.",
    title: "Inquiry Inbox",
    caption: "Inquiries land here. Triage in seconds, not days.",
  },
  {
    src: "/marketing/screenshots/forecast-card.png",
    alt: "Forecast card showing weather adjustment on a future event.",
    title: "Forecast Card",
    caption: "Every event, with weather already accounted for.",
  },
];

export default async function LandingPage() {
  const eventCount = await getEventCount();
  const weatherLossDollars = `$${WEATHER_LOSS_PER_EVENT.toLocaleString()}`;
  const weatherLossReviewedLabel = formatLastReviewed(WEATHER_LOSS_LAST_REVIEWED);

  // Diagonal tint pairing (Row1:L + Row2:R share one tint, others share the other).
  // On desktop this is literal diagonal; on mobile it becomes alternating bands.
  // Tokens come from globals.css → @theme inline (--color-brand-teal +
  // --color-brand-orange) sourced from Brad's Figma export. See
  // docs/design-tokens.md.
  const tintA = "bg-brand-teal/5 border-l-4 border-brand-teal";
  const tintB = "bg-brand-orange/5 border-l-4 border-brand-orange";
  const cardBase = "rounded-lg border p-8 space-y-4 break-words";

  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
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
            <Link href="/pricing" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/roadmap" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">
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
        {/* Hero — full-bleed teal band per Brad's Figma. White text on
            brand-teal background. Phase 2.0: pulled the OG-card claim
            ("Know what your next event will make before you book it.")
            into the hero as a supporting line, and added a CTA pill so
            the hero leads with a benefit + action, not just category
            positioning. Per Verdict #12 (inquiry flow leads acquisition). */}
        <div className="bg-brand-teal text-white">
          <div className="container mx-auto px-4 py-12 text-center">
            <h1
              data-testid="hero-headline"
              className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
            >
              The operating system for{" "}
              <span className="text-white">mobile vendors.</span>
            </h1>
            <p
              data-testid="hero-subline"
              className="mx-auto mt-6 max-w-2xl text-lg text-white/85"
            >
              Built by a food truck operator. For mobile vendors.
            </p>
            <p
              data-testid="hero-supporting-line"
              className="mx-auto mt-4 max-w-2xl text-xl font-medium text-white sm:text-2xl"
            >
              Know what your next event will make before you book it.
            </p>
            <div className="mt-8">
              <Link href="/signup">
                <Button
                  data-testid="hero-cta-start-trial"
                  size="lg"
                  className="rounded-full bg-white px-8 font-semibold text-brand-teal shadow-md hover:bg-white/90"
                >
                  Start free trial
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Insight row — three quantified operations insights side-by-side
            on desktop, stacked on mobile. Phase 2.1 restored Brad's
            original 3+1 framing (the four blocks were never meant to do
            the same job — three are quantified ops insights, one is the
            differentiator/closer positioning block). Operations-first
            ordering: ops insights lead the page so VendCast reads as an
            ops platform that handles leads better than the alternatives,
            not a lead-gen marketplace that does ops on the side.
            Alternating teal/orange/teal border treatment per Brad's note. */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-20 max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Block 1 — Weather (scheduling decision) */}
            <div
              data-testid="insight-block-weather"
              className={`${cardBase} ${tintA}`}
            >
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                Bad-weather risk, flagged before you commit.
              </h2>
              <p className="text-lg font-semibold">
                <span
                  data-testid="insight-finding-weather"
                  className={EMPHASIS_RESOLVED}
                >
                  {weatherLossDollars}
                </span>{" "}
                lost on average per weather-disrupted event.
              </p>
              <p className="text-sm text-muted-foreground">
                Rain, heat, cold snaps — VendCast knows the patterns.
              </p>
              <p
                className="text-xs text-muted-foreground/80"
                data-testid="insight-finding-weather-footnote"
              >
                Average loss per weather-disrupted event, based on VendCast operator data. Last reviewed {weatherLossReviewedLabel}.
              </p>
            </div>

            {/* Block 2 — Forecast accuracy (planning decision).
                Reframed 2026-04-30 from "repeats decline by year three"
                to "accuracy from booking #1." Reasoning: "by year three"
                made urgency too distant; "from booking #1" reframes
                urgency as useful from day one + "tighter as you go"
                promises improvement without overclaiming a specific
                repeat-cohort accuracy number. */}
            <div
              data-testid="insight-block-accuracy"
              className={`${cardBase} ${tintB}`}
            >
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                Forecasts that get sharper with every booking.
              </h2>
              <p className="text-lg font-semibold">
                <span
                  data-testid="insight-finding-accuracy"
                  className={EMPHASIS_RESOLVED}
                >
                  16% accuracy from booking #1.
                </span>{" "}
                Tighter as you go.
              </p>
              <p className="text-sm text-muted-foreground">
                VendCast learns your patterns from day one — and keeps refining as you log.
              </p>
            </div>

            {/* Block 3 — Inquiry pipeline (Phase 7 marketplace
                positioning; replaces the prior revenue-timing block
                now that the marketplace is the leading differentiator). */}
            <div
              data-testid="insight-block-inquiry-pipeline"
              className={`${cardBase} ${tintA}`}
            >
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                Inquiries that don&apos;t fall through the cracks.
              </h2>
              <p className="text-lg font-semibold">
                Event requests hit your inbox and your calendar — auto-flagged, conflict-checked.
              </p>
              <p className="text-sm text-muted-foreground">
                Respond once, schedule once, move on.
              </p>
            </div>
          </div>
        </div>

        {/* Positioning band — full-bleed brand-orange, mirrors the hero's
            teal band visually and brackets the page (teal opens, orange
            closes the strategic argument). This is the differentiator
            moment: ops insights above demonstrate VendCast knows the job;
            this band lands "and you keep all of it — no commission."
            Per Verdict #25, orange is reserved for differentiator/closer
            moments + alternating accents; this is THE orange moment on
            the homepage. */}
        <div
          data-testid="insight-block-inquiries"
          className="border-t bg-brand-orange text-white"
        >
          <div className="container mx-auto px-4 py-16 max-w-4xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              Real inquiries, straight to operators. First to respond, first to book.
            </h2>
            <p className="mt-6 text-xl font-semibold sm:text-2xl">
              <span data-testid="insight-finding-inquiries" className="text-white">
                0%
              </span>{" "}
              commission fee.
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/90">
              When an event needs a vendor, the inquiry goes directly to you — not a
              marketplace that takes 15%.
            </p>
          </div>
        </div>

        {/* "See what operators see" — Phase 2.5 lower-feature-section.
            v33 brief direction (locked 2026-05-02 by Julian): replace
            the prior generic feature grid with actual product
            screenshots that carry their own caption. Three surfaces:
            Today's Event (run-the-day card), Inquiry Inbox (Phase 7
            marketplace's value), Forecast Card (the differentiator).

            Until scripts/capture-screenshots.mjs runs, each frame
            renders a placeholder block. The frame chrome (caption,
            shadow, border-radius) is identical to the live treatment
            so the layout reads the same with or without the PNGs. */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-20">
            <h2 className="text-center text-3xl font-bold mb-4">
              See what operators see
            </h2>
            <p className="text-center text-sm text-muted-foreground mb-12 max-w-xl mx-auto">
              Three surfaces operators open every day. Built for the people running the trucks.
            </p>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {PRODUCT_SCREENS.map((s) => (
                <div key={s.src} className="space-y-4">
                  <div className="aspect-[4/3] rounded-xl border-2 border-dashed border-brand-teal/30 bg-brand-teal/[0.04] overflow-hidden shadow-sm flex items-center justify-center">
                    {/* Placeholder treatment — swap for
                        `<Image src={s.src} alt={s.alt} width={1440}
                        height={1080} className="h-full w-full
                        object-cover" />` once the capture script has
                        produced real PNGs in /public/marketing/
                        screenshots/. */}
                    <div className="text-center px-6">
                      <p className="text-xs font-semibold uppercase tracking-widest text-brand-teal mb-2">
                        Screenshot
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {s.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1.5 font-mono">
                        {s.src.split("/").pop()}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-foreground text-center">
                    {s.caption}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ROI calculator — interactive demo using prospect's own
            inputs. Sits between the feature grid (capability list) and
            the stats row (credibility), making the strategic case
            "this pays for itself for YOUR operation specifically." */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-20 max-w-5xl">
            <RoiCalculator />
          </div>
        </div>

        {/* Stats row */}
        <div className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16">
            <div
              data-testid="stats-row"
              className="grid gap-6 md:grid-cols-3 max-w-3xl mx-auto text-center"
            >
              <div data-testid="stats-events" className="space-y-1">
                <p className="text-4xl font-bold text-primary">
                  {eventCount.toLocaleString()}+
                </p>
                <p className="text-sm text-muted-foreground">
                  events analyzed
                </p>
              </div>
              <div data-testid="stats-accuracy" className="space-y-1">
                <p className="text-4xl font-bold text-primary">4 out of 5</p>
                <p className="text-sm text-muted-foreground">
                  forecasts land in range
                </p>
              </div>
              <div data-testid="stats-years" className="space-y-1">
                <p className="text-4xl font-bold text-primary">5 years</p>
                <p className="text-sm text-muted-foreground">
                  of operator history
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA footer */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-20 text-center">
            <div className="flex flex-col items-center justify-center gap-3">
              <Link href="/signup">
                <Button data-testid="cta-start-free-trial" size="lg" className="gap-2">
                  Start free trial <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <p className="text-sm text-muted-foreground">
                14 days free, no credit card required.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <MarketingFooter />

      {/* Phase 2.6 mobile sticky CTA — fixed-bottom action so the
          conversion path is always one tap away on mobile. Hidden on
          desktop (md+) where the hero pill + footer CTA both stay
          visible during normal scroll. Brand-teal background + white
          text mirrors the hero band so the sticky doesn't introduce a
          new color story. Footer above gets `pb-24 md:pb-8` so the
          sticky doesn't overlap the copyright on mobile. */}
      <div
        data-testid="mobile-sticky-cta"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-brand-teal px-4 py-3 shadow-lg md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <Link href="/signup" className="block">
          <Button
            data-testid="mobile-sticky-cta-button"
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
