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
import {
  BarChart3,
  CalendarDays,
  DollarSign,
  ArrowRight,
  Inbox,
  Plug,
} from "lucide-react";

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

const FEATURE_CARDS = [
  {
    testId: "feature-card-inquiry-booking",
    icon: Inbox,
    title: "Inquiry & Booking Inbox",
    description:
      "New bookings land here — push, email, and in-app, the moment they arrive. Don't miss a lead because you were behind the wheel.",
  },
  {
    testId: "feature-card-event-scheduling",
    icon: CalendarDays,
    title: "Event Scheduling & Tracking",
    description:
      "Every event in one calendar — setup, address, organizer, weather, all a tap away. Catering and vending stay in their own lanes.",
  },
  {
    testId: "feature-card-pos-sync",
    icon: Plug,
    title: "POS & CSV Sync",
    description:
      "Toast, Square, Clover, SumUp — and more. Sales log themselves, or import a CSV.",
  },
  {
    testId: "feature-card-forecasting",
    icon: BarChart3,
    title: "Event Forecasting",
    description:
      "Sales predictions that know about weather, with confidence ranges and plain-English notes. No black box.",
  },
  {
    testId: "feature-card-fee-calculator",
    icon: DollarSign,
    title: "Fee Calculator",
    description:
      "Know your take-home before you say yes. Minimums, percentages, and pro fees — all handled.",
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
                Reframed 2026-05-07 from "16% accuracy from booking #1"
                to "4 out of 5 forecasts land in range." A careful reader
                parses "16% accuracy" as "wrong 84% of the time" — the
                exact wrong inference. The "4 out of 5" framing carries
                the same underlying stat (forecasts within 16% of actual
                count as in-range) but reads correctly on first parse.
                Pair with the existing stats-row treatment at the bottom
                of the page so the homepage uses one framing, not two. */}
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
                  4 out of 5 forecasts land in range.
                </span>{" "}
                Tighter as you go.
              </p>
              <p className="text-sm text-muted-foreground">
                VendCast learns your patterns from day one — and keeps refining as you log.
              </p>
            </div>

            {/* Block 3 — Inquiry pipeline (Phase 7 direct-inquiry
                positioning; replaces the prior revenue-timing block
                now that direct inquiries are the leading
                differentiator). */}
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
            the homepage.
            Reframed 2026-05-07 from "marketplace that takes 15%" to
            "no middleman" framing. VendCast is positioning AGAINST
            marketplace platforms — using "marketplace" in our own
            differentiator copy quietly puts us in the same mental
            category as the platforms we're beating. The "How direct
            inquiries work" line below the headline answers the
            "wait, where do these inquiries come from?" question that
            the original copy left implicit. */}
        <div
          data-testid="insight-block-inquiries"
          className="border-t bg-brand-orange text-white"
        >
          <div className="container mx-auto px-4 py-16 max-w-4xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              Direct inquiries from organizers. First to respond, first to book.
            </h2>
            <p className="mt-6 text-xl font-semibold sm:text-2xl">
              <span data-testid="insight-finding-inquiries" className="text-white">
                0%
              </span>{" "}
              commission. No middleman taking 15%.
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/90">
              Event organizers searching VendCast for vendors in your area
              can request a quote directly. You see it in your inbox; you
              respond; you book.
            </p>
          </div>
        </div>

        {/* Feature grid — Phase 2.5 brand integration. Each card now
            anchors the lucide icon in a brand-teal filled square (white
            icon inside) so the section carries brand presence after the
            strong insight row + orange positioning band above. Card
            border + bg-card unchanged so cards still read as the
            "capability list" rather than competing with the insight row's
            visual weight. */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-20">
            <h2 className="text-center text-3xl font-bold mb-12">
              Built for mobile vendor operators
            </h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {FEATURE_CARDS.map((feature) => (
                <div
                  key={feature.title}
                  data-testid={feature.testId}
                  className="rounded-lg border bg-card p-6"
                >
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-brand-teal text-white shadow-sm">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
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
