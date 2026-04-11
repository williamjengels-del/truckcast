import type { Metadata } from "next";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  TruckIcon,
  BarChart3,
  CloudSun,
  CalendarDays,
  DollarSign,
  ArrowRight,
  CheckCircle,
  Star,
  ClipboardList,
  LineChart,
} from "lucide-react";

// Disable Next.js fetch caching so testimonials always load fresh from the DB
export const revalidate = 0;
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TruckCast by VendCast — The Home Base for Your Food Truck Calendar",
  description:
    "Track every event, know your schedule at a glance — and the only tool that tells you which bookings are actually worth taking. Built for food truck operators by VendCast.",
};

const FALLBACK_TESTIMONIALS = [
  {
    id: "fallback-1",
    content:
      "I used to guess whether to book an event based on gut feel. Now I pull up TruckCast and I know within a few hundred dollars what I'll make. That's a game changer when you're deciding between two events on the same day.",
    author_name: "Julian Engels",
    author_title: "Owner, Wok-O Taco · St. Louis, MO",
    rating: 5,
  },
  {
    id: "fallback-2",
    content:
      "The weather adjustment feature alone is worth it. I had no idea how badly heat and rain were tanking my numbers — TruckCast showed me exactly which events to avoid in July.",
    author_name: "Beta Tester",
    author_title: "Food truck operator · Midwest",
    rating: 5,
  },
  {
    id: "fallback-3",
    content:
      "Finally something built for food trucks, not restaurant chains. The fee calculator saved me from a bad contract last month — the commission-with-minimum math would have eaten my profit.",
    author_name: "Beta Tester",
    author_title: "Food truck operator · Midwest",
    rating: 5,
  },
];

/** Wraps a promise with a hard timeout — if Supabase doesn't respond in time
 *  (e.g. during Vercel build probing), we bail immediately to the fallback. */
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

async function getTestimonials() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return FALLBACK_TESTIMONIALS;
  }
  try {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const query = serviceClient
      .from("testimonials")
      .select("id, author_name, author_title, content, rating")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .then(({ data }) => (data && data.length > 0 ? (data as typeof FALLBACK_TESTIMONIALS) : FALLBACK_TESTIMONIALS));
    return await withTimeout(query, 3000, FALLBACK_TESTIMONIALS);
  } catch {
    return FALLBACK_TESTIMONIALS;
  }
}

export default async function LandingPage() {
  const [testimonials, eventCount] = await Promise.all([
    getTestimonials(),
    getEventCount(),
  ]);
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <TruckIcon className="h-7 w-7 text-primary" />
            <div className="flex flex-col leading-none">
              <span className="text-xl font-bold">TruckCast</span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-wide">by VendCast</span>
            </div>
          </div>
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

      {/* Hero */}
      <section className="flex-1">
        <div className="container mx-auto px-4 py-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            The home base for your
            <br />
            <span className="text-primary">food truck calendar.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Track every event, know your schedule at a glance — and the only
            tool that tells you which bookings are actually worth taking.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className="gap-2">
                Start Free Trial <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <p className="text-sm text-muted-foreground">14 days free · No credit card required</p>
          </div>
        </div>

        {/* Features */}
        <div className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-20">
            <h2 className="text-center text-3xl font-bold mb-12">
              Built for food truck operators
            </h2>
            <p className="text-center text-sm text-muted-foreground -mt-8 mb-12">
              TruckCast is the first product from <span className="font-medium text-foreground">VendCast</span> — software for mobile vendor businesses.
            </p>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: CalendarDays,
                  title: "Event Scheduling & Tracking",
                  description:
                    "Log every event with sales, fees, and notes. See your full calendar and track which events are worth rebooking.",
                },
                {
                  icon: BarChart3,
                  title: "Event Forecasting",
                  description:
                    "AI-powered revenue predictions based on your history, event type, and location patterns.",
                },
                {
                  icon: CloudSun,
                  title: "Weather Intelligence",
                  description:
                    "Automatic weather-adjusted forecasts so you know the real expected revenue.",
                },
                {
                  icon: DollarSign,
                  title: "Fee Calculator",
                  description:
                    "Flat fees, percentages, minimums -- know your take-home before you commit.",
                },
              ].map((feature) => (
                <div
                  key={feature.title}
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

        {/* Social Proof — validated numbers */}
        <div className="container mx-auto px-4 py-16">
          <div className="grid gap-6 md:grid-cols-3 max-w-3xl mx-auto text-center">
            {[
              { stat: `${eventCount.toLocaleString()}+`, label: "Events analyzed — and more added every day as operators log their results" },
              { stat: "Within 16%", label: "Aggregate forecast accuracy on real event data" },
              { stat: "Zero", label: "Spreadsheets required — it's all built in" },
            ].map((s) => (
              <div key={s.label} className="space-y-1">
                <p className="text-4xl font-bold text-primary">{s.stat}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonials */}
        <div className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-20">
            <h2 className="text-center text-3xl font-bold mb-4">
              What food truckers are saying
            </h2>
            <p className="text-center text-muted-foreground mb-12">
              Built by a food truck operator. Validated by real event data. A <span className="font-medium text-foreground">VendCast</span> product.
            </p>
            <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
              {testimonials.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border bg-card p-6 flex flex-col gap-4"
                >
                  <div className="flex gap-0.5">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-primary text-primary" />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground flex-1 italic">
                    &ldquo;{t.content}&rdquo;
                  </p>
                  <div>
                    <p className="font-semibold text-sm">{t.author_name}</p>
                    {t.author_title && (
                      <p className="text-xs text-muted-foreground">{t.author_title}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="container mx-auto px-4 py-20">
          <h2 className="text-center text-3xl font-bold mb-4">How it works</h2>
          <p className="text-center text-muted-foreground mb-12">
            Up and running in minutes. Getting smarter with every event.
          </p>
          <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto">
            {[
              {
                number: "1",
                icon: CalendarDays,
                title: "Add your events",
                description:
                  "Log upcoming and past events with the event name, type, location, and any organizer fees. Import from CSV or connect your POS.",
              },
              {
                number: "2",
                icon: ClipboardList,
                title: "Log your sales",
                description:
                  "After each event, record your net sales. TruckCast automatically calculates performance, trends, and fee impact.",
              },
              {
                number: "3",
                icon: LineChart,
                title: "Get smarter forecasts",
                description:
                  "TruckCast learns from your history to predict future revenue — adjusted for weather, day of week, and event type.",
              },
            ].map((step) => (
              <div key={step.number} className="flex flex-col items-center text-center">
                <div className="relative mb-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <step.icon className="h-7 w-7 text-primary" />
                  </div>
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                    {step.number}
                  </span>
                </div>
                <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing Preview */}
        <div className="container mx-auto px-4 py-20">
          <h2 className="text-center text-3xl font-bold mb-4">
            Simple pricing
          </h2>
          <p className="text-center text-muted-foreground mb-12">
            Start with Starter. Upgrade as you grow.
          </p>
          <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto">
            {[
              {
                name: "Starter",
                price: "$19",
                annualNote: "$182/yr (save $46)",
                features: [
                  "Event Scheduling & Calendar",
                  "Fee Calculator",
                  "Revenue Tracking",
                  "Public Schedule",
                  "Team Share Link",
                ],
              },
              {
                name: "Pro",
                price: "$39",
                annualNote: "$374/yr (save $94)",
                popular: true,
                features: [
                  "Everything in Starter",
                  "Weather-Adjusted Forecasts",
                  "CSV Import",
                  "POS Integration",
                  "Event Performance Analytics",
                ],
              },
              {
                name: "Premium",
                price: "$69",
                annualNote: "$662/yr (save $166)",
                features: [
                  "Everything in Pro",
                  "Advanced Analytics",
                  "Monthly Reports",
                  "Organizer Scoring",
                  "Follow My Truck",
                  "Booking Widget",
                ],
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`rounded-lg border p-6 ${
                  "popular" in tier && tier.popular
                    ? "border-primary ring-1 ring-primary"
                    : ""
                }`}
              >
                {"popular" in tier && tier.popular && (
                  <span className="text-xs font-medium text-primary uppercase tracking-wide">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold mt-1">{tier.name}</h3>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
                {"annualNote" in tier && (
                  <p className="text-xs text-muted-foreground mt-0.5">{tier.annualNote}</p>
                )}
                <ul className="mt-6 space-y-3">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="block mt-6">
                  <Button
                    variant={
                      "popular" in tier && tier.popular ? "default" : "outline"
                    }
                    className="w-full"
                  >
                    Get Started
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground space-y-2">
          <div className="flex items-center justify-center gap-6">
            <Link href="/roadmap" className="hover:text-foreground transition-colors">Roadmap</Link>
            <Link href="/help" className="hover:text-foreground transition-colors">Help Center</Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">Get Started</Link>
            <a href="mailto:support@truckcast.app" className="hover:text-foreground transition-colors">Contact</a>
          </div>
          <p>&copy; {new Date().getFullYear()} VendCast · TruckCast is built for food truck operators, by a food truck operator.</p>
          <p className="text-xs opacity-60">Also at <a href="https://vendcast.co" className="hover:text-foreground transition-colors">vendcast.co</a> · <a href="https://truckcast.co" className="hover:text-foreground transition-colors">truckcast.co</a></p>
        </div>
      </footer>
    </div>
  );
}
