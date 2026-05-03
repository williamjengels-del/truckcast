import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Changelog — VendCast",
  description: "What's new in VendCast — features, fixes, improvements. Updated regularly.",
};

// Hand-curated changelog. Source of truth: notable PRs landing on main
// at github.com/williamjengels-del/truckcast. Curate for operator-
// readability — not every commit goes here, only things operators
// might notice or care about.
//
// Format guideline: 1 entry per shipping moment. Bullet points are
// short and operator-facing (not commit-message-y). Group by date.

interface ChangelogEntry {
  date: string;
  title: string;
  items: { kind: "feat" | "fix" | "polish" | "ops"; text: string }[];
}

const entries: ChangelogEntry[] = [
  {
    date: "May 2, 2026",
    title: "Cross-operator data sharing — fully live",
    items: [
      {
        kind: "feat",
        text: "When you open an event, you'll now see hints under Expected Attendance, Other Trucks, Fee Type, Weather, and the Date field showing what other operators typically see at this event. Privacy-protected — only renders when 2-3+ peers have data on the same event_name.",
      },
      {
        kind: "feat",
        text: "Day-of-week lift across operators: 'Saturdays at this event run 23% above the cross-operator average (5 ops)'. Helps you decide which day to book when an event runs multiple days.",
      },
      {
        kind: "feat",
        text: "Modal weather per (event × month) across operators: 'This event in October typically runs Overcast (5 prior bookings)'. Helps you set realistic weather expectations on a new booking.",
      },
      {
        kind: "feat",
        text: "Median fee structure across operators: 'Other operators at this event: typically Flat Fee ($200 median) (across 4 operators)'. Set fee expectations on new venues.",
      },
      {
        kind: "fix",
        text: "Fixed: prepaid (pre_settled fee_type) events now read the contract amount from sales_minimum if fee_rate is empty, AND the 'Enter sales' quick action is restored so you can log walk-up sales on top of the contract.",
      },
      {
        kind: "fix",
        text: "Fixed: chatbot 'what's my best repeat booking?' question now works (was failing on a column-reference error).",
      },
      {
        kind: "fix",
        text: "Fixed: chatbot 'what's coming up next two weeks' now correctly returns only booked events by default.",
      },
      {
        kind: "polish",
        text: "Chatbot message readability — multi-line lists no longer collapse to walls of text.",
      },
      {
        kind: "polish",
        text: "Public ROI calculator on homepage — operators can run their own pay-for-itself math before signing up.",
      },
      {
        kind: "polish",
        text: "Dashboard breathing room bump for a slightly more airy feel.",
      },
      {
        kind: "polish",
        text: "Phase 4 design rollout: dashboard root, events page, and integrations page all migrated to brand tokens.",
      },
      {
        kind: "feat",
        text: "Events table density toggle — opt-in 'Compact / Advanced' switch on Past+Booked. Advanced mode adds Type / Fees out / Forecast / Profit columns.",
      },
      {
        kind: "feat",
        text: "Forecast column restored on Past+Booked event view.",
      },
      {
        kind: "feat",
        text: "auto_ended_at audit cron — 15-min sweep keeps the audit trail complete even if you skip the dashboard for a stretch.",
      },
      {
        kind: "ops",
        text: "Stripe trial cutoff extended to July 1, 2026.",
      },
    ],
  },
  {
    date: "April 30, 2026",
    title: "Day-of Event Card v1 — operator cockpit shipped",
    items: [
      {
        kind: "feat",
        text: "New 'Today's Event' card pinned to the top of the dashboard with parking & load-in notes, on-site contact, setup countdown, weather window, sales pace bar, in-service notes (timestamped), content capture, and an after-event wrap-up form.",
      },
      {
        kind: "feat",
        text: "Multi-event days: stack rendering with 'Now' + 'Up next today'. Auto-promotes the next event when the current one ends.",
      },
      {
        kind: "feat",
        text: "Hourly weather slice + wind alert for the service window (Premium).",
      },
      {
        kind: "feat",
        text: "Events page chip filtering: 4 tabs × 8 chips, URL-persistent. Replaces the old fixed-tab setup with operator-driven filtering.",
      },
      {
        kind: "feat",
        text: "Cross-operator platform-blend forecasts: 'Based on your N prior bookings + M other operators' data'. Privacy floor: 2+ other operators required, requesting operator self-filtered.",
      },
    ],
  },
  {
    date: "April 29, 2026",
    title: "Tier-B 'Ask your data' chatbot",
    items: [
      {
        kind: "feat",
        text: "Premium-tier chatbot widget in the dashboard — ask questions about your event history, performance, and upcoming calendar. Answers grounded in your real data, not generic advice.",
      },
      {
        kind: "feat",
        text: "Sold-out cancellation reason linkage: cancelled events caused by sold-out earlier events drop out of forecast accuracy denominators (your overrun is the credited outcome, the carry-over isn't penalized).",
      },
      {
        kind: "feat",
        text: "TOTP 2FA fully shipped — enroll, login challenge, recovery codes, admin reset path.",
      },
      {
        kind: "polish",
        text: "Replaced the 'Learning' confidence pill with a softer comparison-anchor sentence on thin-data forecasts.",
      },
    ],
  },
  {
    date: "April 28, 2026",
    title: "Brand identity, custom slugs, and per-operator brand pages",
    items: [
      {
        kind: "polish",
        text: "Brad's brand tokens live: VendCast teal + orange across marketing, auth, and per-operator public pages.",
      },
      {
        kind: "feat",
        text: "Public operator slug system: vendcast.co/<your-slug> resolves to your branded schedule page.",
      },
      {
        kind: "feat",
        text: "Login notifications on new device: opt-in security signal email.",
      },
    ],
  },
  {
    date: "April 24, 2026",
    title: "Dunning, payment-failed handling, and admin tools",
    items: [
      {
        kind: "feat",
        text: "Stripe past-due / payment-failed handling: dunning banner, admin payment-failing filter.",
      },
      {
        kind: "feat",
        text: "Admin Toast inbox triage for unmatched payments.",
      },
      {
        kind: "feat",
        text: "Custom slugs scaffold for the operator public-page system.",
      },
    ],
  },
  {
    date: "April 17, 2026",
    title: "Weather adjustments + forecast confidence ranges",
    items: [
      {
        kind: "feat",
        text: "Weather coefficient visibility on upcoming event forecasts — shows the dollar impact of weather when it crosses ≥$50 AND ≥5% of forecast.",
      },
      {
        kind: "feat",
        text: "Forecast ranges: LOW/MED/HIGH confidence bands (±40% / ±25% / ±15%). Stored alongside the point forecast.",
      },
      {
        kind: "feat",
        text: "Dashboard hero chart: rolling 12-week actual + projected revenue.",
      },
    ],
  },
];

const KIND_LABELS: Record<ChangelogEntry["items"][number]["kind"], { label: string; className: string }> = {
  feat: {
    label: "New",
    className: "bg-brand-teal/10 text-brand-teal border-brand-teal/20",
  },
  fix: {
    label: "Fix",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
  polish: {
    label: "Polish",
    className: "bg-brand-orange/10 text-brand-orange border-brand-orange/20",
  },
  ops: {
    label: "Ops",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav (mirrors homepage) */}
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
            <Link href="/pricing" className="text-sm hover:text-brand-teal hidden sm:inline-block px-3 py-2">
              Pricing
            </Link>
            <Link href="/help" className="text-sm hover:text-brand-teal hidden sm:inline-block px-3 py-2">
              Help
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Start free trial</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="container mx-auto px-4 py-16 max-w-3xl">
          <div className="mb-12 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-teal mb-3">
              What&apos;s new
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Changelog
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              VendCast ships frequently. Here&apos;s what&apos;s changed for operators recently — features, fixes, and the polish in between.
            </p>
          </div>

          <div className="space-y-12">
            {entries.map((entry, i) => (
              <article key={i} className="relative">
                {/* Date + title */}
                <div className="mb-4 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
                  <h2 className="text-xl font-bold tracking-tight">{entry.title}</h2>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1 sm:mt-0">
                    {entry.date}
                  </p>
                </div>
                {/* Items */}
                <ul className="space-y-3">
                  {entry.items.map((item, j) => {
                    const kind = KIND_LABELS[item.kind];
                    return (
                      <li key={j} className="flex items-start gap-3">
                        <span
                          className={`shrink-0 mt-0.5 inline-flex items-center justify-center text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border ${kind.className}`}
                        >
                          {kind.label}
                        </span>
                        <p className="text-sm text-foreground leading-relaxed">{item.text}</p>
                      </li>
                    );
                  })}
                </ul>
              </article>
            ))}
          </div>

          <div className="mt-20 pt-10 border-t text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Want to suggest a feature or report something broken?
            </p>
            <Link href="/contact">
              <Button variant="outline">Send feedback</Button>
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <Link href="/" className="hover:text-brand-teal">VendCast</Link>
          {" · "}
          <Link href="/pricing" className="hover:text-brand-teal">Pricing</Link>
          {" · "}
          <Link href="/help" className="hover:text-brand-teal">Help</Link>
          {" · "}
          <Link href="/roadmap" className="hover:text-brand-teal">Roadmap</Link>
        </div>
      </footer>
    </div>
  );
}
