import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Roadmap — VendCast",
  description: "What's shipped, what we're building, and what's coming.",
};

type PhaseStatus = "SHIPPED" | "BUILDING" | "NEXT" | "LATER";

interface Phase {
  label: string;
  tagline: string;
  status: PhaseStatus;
  bullets: string[];
}

const PHASES: Phase[] = [
  {
    label: "Phase 1 — Operational Foundation",
    tagline: "The daily tools every mobile vendor needs, in one place.",
    status: "SHIPPED",
    bullets: [
      "Event scheduling with catering and vending modes",
      "Organizer contacts and customer follower management",
      "Public booking page with inbound inquiry inbox",
      "POS integration with Toast, Square, Clover, and SumUp",
      "Spreadsheet and CSV import for historical data",
      "Mobile app with push and email notifications",
      "Fully responsive mobile experience with offline support",
    ],
  },
  {
    label: "Phase 2 — Forecast Intelligence",
    tagline: "Honest revenue forecasts that get sharper over time.",
    status: "SHIPPED",
    bullets: [
      "Weather-aware sales predictions with confidence ranges",
      "Auto-derived event performance tiers based on your history",
      "Network-enhanced forecasts: your predictions improve as similar operators join",
      "Transparent confidence scoring so you know what's reliable and what isn't",
      "Plain-English forecast explanations, not raw numbers",
    ],
  },
  {
    label: "Phase 3 — Professional Account Experience",
    tagline: "VendCast runs like the serious tool your business needs.",
    status: "SHIPPED",
    bullets: [
      "Clean signup with email verification and secure password handling",
      "Simple subscription management with monthly or annual billing (20% annual discount)",
      "14-day trial with transparent pricing",
      "Two-factor authentication and new-device login alerts",
      "Complete activity history on your account",
      "Direct support for operator questions",
    ],
  },
  {
    label: "Phase 4 — Event Lifecycle",
    tagline: "Every stage of an event, captured in one tool.",
    status: "SHIPPED",
    bullets: [
      "Inquiry intake with event details, dates, attendance, and notes",
      "Quote-to-booking conversion tracking",
      "Calendar view with weather integration",
      "Post-event sales tracking through your POS",
      "Performance analysis against forecasts",
    ],
  },
  {
    label: "Phase 5 — Financial Clarity",
    tagline: "Know what every event is actually worth.",
    status: "BUILDING",
    bullets: [
      "Distinction between contract-fee events (catering) and variable-sales events (vending)",
      "Payment tracking with automatic POS transaction matching",
      "Anomaly flagging for disrupted or boosted events",
      "True forecast accuracy measurement on comparable events only",
    ],
  },
  {
    label: "Phase 6 — Design & Experience",
    tagline: "A refined visual identity that matches the quality of the product underneath.",
    status: "BUILDING",
    bullets: [
      "New brand system in development",
      "Refreshed interface that prioritizes operator clarity and speed",
      "Continued polish across every surface as the product evolves",
    ],
  },
  {
    label: "Phase 7 — The Operator Network",
    tagline: "Your business profile becomes your booking channel.",
    status: "NEXT",
    bullets: [
      "Custom vendor profile URLs for sharing and SEO",
      "Embeddable booking widget for your website, Linktree, or social",
      "Public vendor profiles as lead-capture surfaces",
      "Cross-operator data enrichment at venue and event-type level",
    ],
  },
  {
    label: "Phase 8 — The Marketplace",
    tagline: "Event organizers find the right vendors. Vendors find the right gigs.",
    status: "LATER",
    bullets: [
      "Organizer tools to discover and book vendors directly through VendCast",
      "Vendor matching based on historical performance and fit",
      "Transparent ratings and reviews",
      "Built on the data foundation of Phases 1–7",
    ],
  },
];

const STATUS_STYLES: Record<PhaseStatus, string> = {
  SHIPPED:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  BUILDING:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  NEXT:
    "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  LATER:
    "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};

// Softer tints for the full-card background fill. Same hue family as
// the pill but lighter so body text stays readable at 14px/15px.
const CARD_STYLES: Record<PhaseStatus, string> = {
  SHIPPED:
    "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
  BUILDING:
    "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  NEXT:
    "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30",
  LATER:
    "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50",
};

function StatusPill({ status }: { status: PhaseStatus }) {
  return (
    <span
      className={`inline-block text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export default function RoadmapPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav — sticky preserved for the long scrolly page; logo swapped
          to Brad's two-color wordmark to match the homepage + pricing
          surfaces. Phase 2 brand rollout. */}
      <nav className="border-b bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center" aria-label="VendCast home">
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={400}
              height={140}
              className="h-9 w-auto"
            />
          </Link>
          <Link href="/signup">
            <Button size="sm">Start free trial</Button>
          </Link>
        </div>
      </nav>

      {/* Hero band — full-bleed teal, matching the homepage + /pricing
          treatment. Carries the H1 + intro subline only; founder note +
          phase count drop into the body content below. */}
      <div className="bg-brand-teal text-white">
        <div className="max-w-3xl mx-auto px-6 py-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            The operating system for mobile vendors
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/85">
            Built for solo operators and small teams running any kind of mobile vendor business — from food trucks to pop-up retail.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        {/* Header context — italic founder note + phase count. Pulled out
            of the (now teal) hero band so the band stays clean. */}
        <header className="mb-12">
          <p className="text-sm italic text-muted-foreground/90 mb-6">
            Built by a St. Louis food truck operator who ran his own truck for five years before realizing no one had built the tool he needed.
          </p>
          <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
            4 phases shipped · 2 building now · 2 planned
          </p>
        </header>

        {/* Your data stays yours callout */}
        <section className="mb-12 rounded-xl border-2 border-primary/20 bg-primary/5 p-6">
          <h2 className="text-lg font-semibold mb-2">Your data stays yours</h2>
          <p className="text-sm mb-3">
            VendCast is built on a simple principle: your business data is yours alone.
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="text-primary mt-0.5 shrink-0" aria-hidden>•</span>
              <span>No other operator can access your events, contacts, sales, or customer information. Ever.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary mt-0.5 shrink-0" aria-hidden>•</span>
              <span>Your data isn&apos;t sold, licensed, or shared with third parties.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary mt-0.5 shrink-0" aria-hidden>•</span>
              <span>
                The only cross-operator information is privacy-first performance signal — patterns, not records — used solely to improve everyone&apos;s forecast accuracy.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary mt-0.5 shrink-0" aria-hidden>•</span>
              <span>Every administrative action on our end is logged and auditable.</span>
            </li>
          </ul>
        </section>

        {/* Phases — each block wraps in the same card treatment as the
            "Your data stays yours" callout above so the page reads as
            one visual system. */}
        <div className="space-y-10">
          {PHASES.map((phase) => (
            <section
              key={phase.label}
              className={`rounded-xl border-2 p-6 ${CARD_STYLES[phase.status]}`}
            >
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <StatusPill status={phase.status} />
                <h3 className="text-lg sm:text-xl font-semibold">
                  {phase.label}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground italic mb-3">
                {phase.tagline}
              </p>
              <ul className="space-y-1.5 text-sm">
                {phase.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-muted-foreground mt-0.5 shrink-0" aria-hidden>•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* CTA footer — simplified per the homepage discipline (single
            primary CTA, no dual-path "Try the calculator" link, no
            decorative TruckIcon). Mirrors the homepage's bottom CTA so
            both surfaces close with the same affordance. */}
        <div className="mt-16 text-center rounded-2xl border bg-primary/5 border-primary/20 p-8 sm:p-10">
          <h2 className="text-2xl font-bold mb-2">
            Ready to run your business from one place?
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Inquiries, bookings, calendar, sales, and forecasts — in one place. 14-day free trial, no credit card required.
          </p>
          <div className="flex justify-center">
            <Link href="/signup">
              <Button size="lg">Start free trial</Button>
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Built by a food truck operator of five years.{" "}
            <Link href="/" className="text-primary hover:underline">
              vendcast.co
            </Link>
          </p>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
