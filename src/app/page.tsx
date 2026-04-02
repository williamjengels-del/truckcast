import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  TruckIcon,
  BarChart3,
  CloudSun,
  CalendarDays,
  DollarSign,
  ArrowRight,
  CheckCircle,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <TruckIcon className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">TruckCast</span>
          </div>
          <div className="flex items-center gap-3">
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
            Know what every event is worth
            <br />
            <span className="text-primary">before you book it.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            TruckCast uses your historical sales data, weather intelligence, and
            event analytics to forecast revenue for every event on your calendar.
            Stop guessing. Start optimizing.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/signup">
              <Button size="lg" className="gap-2">
                Start Free Trial <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-20">
            <h2 className="text-center text-3xl font-bold mb-12">
              Built for food truck operators
            </h2>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {[
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
                  icon: CalendarDays,
                  title: "Event Tracking",
                  description:
                    "Log every event with sales, fees, and notes. See which events are worth rebooking.",
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
                price: "$29",
                features: [
                  "Manual event entry",
                  "Fee calculator",
                  "Performance tracking",
                  "Basic dashboard",
                ],
              },
              {
                name: "Pro",
                price: "$79",
                popular: true,
                features: [
                  "Everything in Starter",
                  "POS integration (Square, Toast)",
                  "Weather-adjusted forecasts",
                  "Public schedule page",
                ],
              },
              {
                name: "Premium",
                price: "$149",
                features: [
                  "Everything in Pro",
                  "Organizer quality scoring",
                  "Risk-adjusted profitability",
                  "Monthly reports",
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
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} TruckCast. Built for food truck
          operators, by a food truck operator.
        </div>
      </footer>
    </div>
  );
}
