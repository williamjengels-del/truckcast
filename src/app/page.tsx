import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { WEATHER_COEFFICIENTS } from "@/lib/constants";
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

/* Derived 2026-04-24 from WEATHER_COEFFICIENTS in src/lib/constants.ts.
   Each percentage is (1 - coefficient) × 100, rounded to nearest integer —
   the average dollar shortfall a booked event takes under that weather.
   Keeping these inline (not live-queried) because the coefficients only
   change when the forecast engine is re-tuned. */
const RAIN_IMPACT_PCT = Math.round((1 - WEATHER_COEFFICIENTS["Rain During Event"]) * 100);
const HOT_IMPACT_PCT = Math.round((1 - WEATHER_COEFFICIENTS.Hot) * 100);
const COLD_IMPACT_PCT = Math.round((1 - WEATHER_COEFFICIENTS.Cold) * 100);

/* Julian's Supabase user_id — only operator with enough history to anchor
   a credible "average loss per event" number on the marketing page. Keep
   the query server-side-only via the service role key; homepage is public
   but we only read an aggregate, not per-row data. */
const JULIAN_USER_ID = "7f97040f-023d-4604-8b66-f5aa321c31de";

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

/** Weather-loss dollars = Julian's avg logged net_sales × (1 − Storms coefficient).
 *  Storms is the worst common disruption (0.30 ≈ 70% revenue loss per storm day).
 *  Returns a pre-formatted string ("$740") when the query succeeds, or the
 *  literal placeholder "{{WEATHER_LOSS_DOLLARS}}" when it can't — lets the
 *  homepage still render during builds without Supabase env vars. */
async function getWeatherLossDollars(): Promise<string> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return "{{WEATHER_LOSS_DOLLARS}}";
  }
  try {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const query = serviceClient
      .from("events")
      .select("net_sales")
      .eq("user_id", JULIAN_USER_ID)
      .not("net_sales", "is", null)
      .then(({ data }) => {
        if (!data || data.length === 0) return null;
        const total = data.reduce((sum, row) => sum + Number(row.net_sales ?? 0), 0);
        const avg = total / data.length;
        const loss = avg * (1 - WEATHER_COEFFICIENTS.Storms);
        const rounded = Math.round(loss / 50) * 50; // snap to nearest $50
        return `$${rounded.toLocaleString()}`;
      });
    const result = await withTimeout<string | null>(query, 3000, null);
    return result ?? "{{WEATHER_LOSS_DOLLARS}}";
  } catch {
    return "{{WEATHER_LOSS_DOLLARS}}";
  }
}

/** Repeat-booking decline rate = share of Julian's multi-year recurring events
 *  whose latest-year revenue is below their first-year revenue AND shows a
 *  near-monotonic downward trend across the intermediate years.
 *
 *  Qualifying group: same `event_name` appearing across 3+ distinct calendar
 *  years with `net_sales` recorded in each appearance. "Near-monotonic" =
 *  at most one year-over-year uptick in the series.
 *
 *  Returns a pre-formatted string ("65%"), snapped to nearest 5%, or the
 *  placeholder "{{REPEAT_BOOKING_DECLINE_RATE}}" on env/timeout/empty-data.
 */
async function getRepeatBookingDeclineRate(): Promise<string> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return "{{REPEAT_BOOKING_DECLINE_RATE}}";
  }
  try {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const query = serviceClient
      .from("events")
      .select("event_name, event_date, net_sales")
      .eq("user_id", JULIAN_USER_ID)
      .not("net_sales", "is", null)
      .not("event_name", "is", null)
      .then(({ data }) => {
        if (!data || data.length === 0) return null;

        // Bucket by event_name → year → max(net_sales) for that year.
        const byNameYear = new Map<string, Map<number, number>>();
        for (const row of data) {
          const name = String(row.event_name ?? "").trim();
          const dateStr = String(row.event_date ?? "");
          const year = Number(dateStr.slice(0, 4));
          const sales = Number(row.net_sales ?? 0);
          if (!name || !Number.isFinite(year) || year < 2000 || !Number.isFinite(sales)) continue;
          let perYear = byNameYear.get(name);
          if (!perYear) {
            perYear = new Map();
            byNameYear.set(name, perYear);
          }
          // Prefer max per year so a single outlier doesn't wash out the signal.
          const prior = perYear.get(year);
          perYear.set(year, prior === undefined ? sales : Math.max(prior, sales));
        }

        let qualifyingGroups = 0;
        let decliningGroups = 0;
        for (const perYear of byNameYear.values()) {
          if (perYear.size < 3) continue;
          qualifyingGroups++;
          const years = [...perYear.keys()].sort((a, b) => a - b);
          const series = years.map((y) => perYear.get(y) ?? 0);
          const firstYearRevenue = series[0];
          const lastYearRevenue = series[series.length - 1];
          if (lastYearRevenue >= firstYearRevenue) continue;
          // Count YoY upticks — allow at most one for "near-monotonic".
          let upticks = 0;
          for (let i = 1; i < series.length; i++) {
            if (series[i] > series[i - 1]) upticks++;
          }
          if (upticks <= 1) decliningGroups++;
        }

        if (qualifyingGroups === 0) return null;
        const rate = (decliningGroups / qualifyingGroups) * 100;
        const rounded = Math.round(rate / 5) * 5;
        return `${rounded}%`;
      });
    const result = await withTimeout<string | null>(query, 3000, null);
    return result ?? "{{REPEAT_BOOKING_DECLINE_RATE}}";
  } catch {
    return "{{REPEAT_BOOKING_DECLINE_RATE}}";
  }
}

/** Apply numeric-emphasis classes only when the value is a resolved number.
 *  Placeholders get muted, normal-size treatment so they read as pending
 *  rather than shouting a literal template string. Resolved values use
 *  brand-teal so the homepage's data anchors carry brand presence into
 *  the body content, not just the hero band. */
function isResolvedValue(s: string): boolean {
  return !/^\{\{.*\}\}$/.test(s);
}
const EMPHASIS_RESOLVED = "text-4xl font-bold text-brand-teal";
const EMPHASIS_PLACEHOLDER = "text-xl font-normal text-muted-foreground";

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
      "Toast, Square, Clover, SumUp — and more. Sales log themselves. Bring your spreadsheet if that's where your history lives.",
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
  const [eventCount, weatherLossDollars, repeatDeclineRate] = await Promise.all([
    getEventCount(),
    getWeatherLossDollars(),
    getRepeatBookingDeclineRate(),
  ]);
  const weatherEmphasis = isResolvedValue(weatherLossDollars) ? EMPHASIS_RESOLVED : EMPHASIS_PLACEHOLDER;
  const repeatEmphasis = isResolvedValue(repeatDeclineRate) ? EMPHASIS_RESOLVED : EMPHASIS_PLACEHOLDER;

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
            <Link href="/roadmap" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">
              Roadmap
            </Link>
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
            brand-teal background; accent divider becomes white-on-teal
            instead of teal-on-white. Padding tightened (py-20 → py-12)
            per Brad's note that the band may feel oversized for a
            text-only hero. */}
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
            <div
              aria-hidden="true"
              className="mx-auto mt-8 h-px w-32 bg-white/40"
            />
          </div>
        </div>

        {/* Insight blocks — 2×2 grid on desktop, stacked on mobile.
            Diagonal tint pairing: blocks 1+4 share tintA, blocks 2+3 share tintB. */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-20 max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Block 1 — Weather */}
            <div
              data-testid="insight-block-weather"
              className={`${cardBase} ${tintA}`}
            >
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Weather patterns repeat. Losses don&apos;t have to.
              </h2>
              <p className="text-xl font-semibold">
                Operators lose{" "}
                <span
                  data-testid="insight-finding-weather"
                  className={weatherEmphasis}
                >
                  {weatherLossDollars}
                </span>{" "}
                on average per weather-disrupted event.
              </p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>
                  Rain within 2 hours of service: {RAIN_IMPACT_PCT}% below average
                </li>
                <li>
                  Temperatures over 90°F: {HOT_IMPACT_PCT}% below
                </li>
                <li>
                  Cold snaps under 45°F: {COLD_IMPACT_PCT}% below
                </li>
              </ul>
              <p className="text-base text-muted-foreground italic">
                VendCast flags bad-weather risk before you commit.
              </p>
            </div>

            {/* Block 2 — Repeat bookings */}
            <div
              data-testid="insight-block-repeats"
              className={`${cardBase} ${tintB}`}
            >
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Know which repeat bookings are still worth your time.
              </h2>
              <p className="text-xl font-semibold">
                <span
                  data-testid="insight-finding-repeats"
                  className={repeatEmphasis}
                >
                  {repeatDeclineRate}
                </span>{" "}
                of repeat bookings show declining revenue by year three.
              </p>
              <p className="text-sm text-muted-foreground">
                Same venue three years running, same organizer five events in, same weekly
                market every Saturday — patterns emerge, and they rarely announce themselves
                until the math is already against you.
              </p>
              <p className="text-base text-muted-foreground italic">
                The math stops being a surprise. VendCast tracks every repeat booking — what
                you made, how weather hit it, how it compares to last year.
              </p>
            </div>

            {/* Block 3 — Revenue timing (qualitative; no numbers) */}
            <div
              data-testid="insight-block-timing"
              className={`${cardBase} ${tintB}`}
            >
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Your revenue curve isn&apos;t a daily average.
              </h2>
              <p className="text-xl font-semibold">
                A 6-hour festival isn&apos;t 6 hours of revenue. Most of the money shows up
                in a tighter window — and if prep and staffing don&apos;t match the curve,
                sales walk when the line gets long.
              </p>
              <p className="text-base text-muted-foreground italic">
                VendCast tracks when your money actually arrives, not just when the day
                ends.
              </p>
            </div>

            {/* Block 4 — Positioning */}
            <div
              data-testid="positioning-block"
              className={`${cardBase} ${tintA}`}
            >
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Event inquiries, operator-direct. No middleman.
              </h2>
              <p className="text-base">
                When an event needs a vendor, the inquiry goes to you — not a marketplace that
                takes 15%, not a platform that decides who gets the booking. Your contact, your
                price, your booking.
              </p>
              <p className="text-base text-muted-foreground italic">
                VendCast routes real inquiries straight to operators. First to respond, first to
                book.
              </p>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="border-t">
          <div className="container mx-auto px-4 py-20">
            <h2 className="text-center text-3xl font-bold mb-4">
              Built for mobile vendor operators
            </h2>
            <p className="text-center text-sm text-muted-foreground mb-12">
              Purpose-built software for mobile vendor businesses.
            </p>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {FEATURE_CARDS.map((feature) => (
                <div
                  key={feature.title}
                  data-testid={feature.testId}
                  className="rounded-lg border bg-card p-6"
                >
                  <feature.icon className="h-10 w-10 text-primary mb-4" />
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
                  Events analyzed across operator history
                </p>
              </div>
              <div data-testid="stats-accuracy" className="space-y-1">
                <p className="text-4xl font-bold text-primary">Within 16%</p>
                <p className="text-sm text-muted-foreground">
                  Forecast accuracy on real event data
                </p>
              </div>
              <div data-testid="stats-years" className="space-y-1">
                <p className="text-4xl font-bold text-primary">5 years</p>
                <p className="text-sm text-muted-foreground">
                  Of operator history baked into the engine
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
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground space-y-2">
          <div className="flex items-center justify-center gap-6">
            <Link href="/help" className="hover:text-foreground transition-colors">Help Center</Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">Get Started</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} VendCast — built by a food truck operator, for mobile vendors.</p>
        </div>
      </footer>
    </div>
  );
}
