import type { Metadata } from "next";
import Link from "next/link";
import { TruckIcon, CheckCircle2, Circle, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "VendCast Roadmap — Built for Food Truck Operators",
  description: "See how VendCast grew from an Airtable spreadsheet to a full AI-powered forecasting platform for food truck operators.",
};

type MilestoneStatus = "done" | "in_progress" | "planned";

interface Milestone {
  label: string;
  status: MilestoneStatus;
  note?: string;
}

interface Phase {
  number: number;
  name: string;
  tagline: string;
  color: string;
  accent: string;
  badge: string;
  status: MilestoneStatus;
  milestones: Milestone[];
}

const PHASES: Phase[] = [
  {
    number: 0,
    name: "The Problem",
    tagline: "Every booking tracked by hand. No way to predict what an event would make.",
    color: "bg-slate-50 dark:bg-slate-900/30",
    accent: "border-slate-300 dark:border-slate-700",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    status: "done",
    milestones: [
      { label: "Wok-O Taco (St. Louis) tracked every event by hand in a spreadsheet", status: "done" },
      { label: "Booking a new event meant guessing revenue — no data-backed answer", status: "done" },
      { label: "The manual system worked for one truck, but couldn't help other operators", status: "done" },
      { label: "Decision: turn the system into a platform any food truck could use", status: "done" },
    ],
  },
  {
    number: 1,
    name: "Foundation",
    tagline: "A solid, secure platform built to last — ready for real operators from day one.",
    color: "bg-blue-50 dark:bg-blue-950/20",
    accent: "border-blue-300 dark:border-blue-700",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    status: "done",
    milestones: [
      { label: "Platform live at vendcast.co — fast, secure, accessible on any device", status: "done" },
      { label: "Every operator's data completely private — no cross-contamination between accounts", status: "done" },
      { label: "Sign in with email or Google — no password hassle", status: "done" },
      { label: "Built to store your full event history, forecasts, and performance over time", status: "done" },
      { label: "Clean, modern design that works on phone, tablet, and desktop", status: "done" },
    ],
  },
  {
    number: 2,
    name: "Core Product",
    tagline: "Add your events, see your forecast, understand what drives your revenue.",
    color: "bg-violet-50 dark:bg-violet-950/20",
    accent: "border-violet-300 dark:border-violet-700",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
    status: "done",
    milestones: [
      { label: "Add, edit, and manage all your bookings in one place — or import from a spreadsheet", status: "done" },
      { label: "Fee calculator handles flat fees, percentages, pre-settled, and day rates", status: "done" },
      { label: "AI forecast engine predicts revenue for upcoming events", status: "done", note: "Validated: within 16% of actual revenue on aggregate forecasts" },
      { label: "Forecasts automatically adjust for weather, day of week, and attendance size", status: "done" },
      { label: "Enter your city, and VendCast automatically looks up the weather and location coordinates", status: "done" },
      { label: "The more events you log, the smarter your forecasts get", status: "done" },
      { label: "Dashboard with year-to-date revenue, upcoming projections, and trends at a glance", status: "done" },
      { label: "See which events, event types, and organizers are most valuable to your business", status: "done" },
    ],
  },
  {
    number: 3,
    name: "POS Integrations",
    tagline: "Connect your card reader — sales log themselves after every event.",
    color: "bg-emerald-50 dark:bg-emerald-950/20",
    accent: "border-emerald-300 dark:border-emerald-700",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    status: "done",
    milestones: [
      { label: "Square: connect once, sales sync automatically each day", status: "done" },
      { label: "Clover: same seamless auto-sync as Square", status: "done" },
      { label: "Toast: forward your daily summary email and it syncs hands-free", status: "done" },
      { label: "Automatic email routing so Toast users don't have to do anything after setup", status: "done" },
      { label: "Run multiple locations? Pick which one VendCast pulls from", status: "done" },
      { label: "If you had two events on the same day, VendCast splits the revenue intelligently", status: "done" },
    ],
  },
  {
    number: 4,
    name: "Go to Market",
    tagline: "Real pricing, a free trial, and a beta program for early operators.",
    color: "bg-orange-50 dark:bg-orange-950/20",
    accent: "border-orange-300 dark:border-orange-700",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    status: "done",
    milestones: [
      { label: "VendCast brand launched at vendcast.co — software for food truck operators", status: "done" },
      { label: "Starter, Pro, and Premium plans — pay for what you need", status: "done" },
      { label: "14-day free trial so you can see the value before committing", status: "done" },
      { label: "Beta invite codes to bring early adopters aboard first", status: "done" },
      { label: "Automated emails for welcome, trial reminders, and important updates", status: "done" },
      { label: "Free forecast calculator — try it before you even sign up", status: "done" },
      { label: '"What if?" tool — adjust weather or attendance and see how your forecast changes', status: "done" },
      { label: "Admin view for monitoring health and activity across all operator accounts", status: "done" },
    ],
  },
  {
    number: 5,
    name: "Reliability & Speed",
    tagline: "Under-the-hood work to make everything faster and more dependable.",
    color: "bg-cyan-50 dark:bg-cyan-950/20",
    accent: "border-cyan-300 dark:border-cyan-700",
    badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
    status: "done",
    milestones: [
      { label: "Eliminated duplicate sync code — every POS provider now works the same way", status: "done" },
      { label: "Centralized performance recalculation — one change updates everything correctly", status: "done" },
      { label: "Consistent sync status tracking across Square, Clover, and Toast", status: "done" },
      { label: "17 automated tests running on every code change — catches regressions before you see them", status: "done" },
      { label: "Fixed new user profile creation — no more blank accounts after signup", status: "done" },
    ],
  },
  {
    number: 6,
    name: "Onboarding & Guidance",
    tagline: "VendCast now meets you where you are and shows you what to do next.",
    color: "bg-pink-50 dark:bg-pink-950/20",
    accent: "border-pink-300 dark:border-pink-700",
    badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
    status: "done",
    milestones: [
      { label: "Setup checklist on your dashboard so you always know the next step", status: "done" },
      { label: "Smart onboarding guide — changes based on how far along you are", status: "done" },
      { label: "Guided tour on first login — 60-second walkthrough of the key features", status: "done" },
      { label: "Crew view — share a read-only link with your team so they always know where to be", status: "done" },
      { label: "Navigation works the same on mobile and desktop — nothing gets left out", status: "done" },
      { label: "When you add your Toast sync address to Gmail, a button appears to confirm it — no more hunting for a link", status: "done" },
      { label: "Email reminder the day after an event if sales haven't been logged yet", status: "done" },
      { label: "Nudge to connect your POS when you're manually logging sales", status: "done" },
      { label: "Public roadmap at vendcast.co/roadmap — see exactly what's been built and what's coming", status: "done" },
    ],
  },
  {
    number: 7,
    name: "Growth & Community",
    tagline: "Know your best organizers, grow your fan base, and manage more than one truck.",
    color: "bg-amber-50 dark:bg-amber-950/20",
    accent: "border-amber-300 dark:border-amber-700",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    status: "planned",
    milestones: [
      { label: "Organizer ratings — automatically score which event organizers bring in the most revenue", status: "planned" },
      { label: "Fan / follower system — let customers subscribe to your schedule (Premium)", status: "planned" },
      { label: "Multi-truck accounts — manage a whole fleet under one login", status: "planned" },
      { label: "Discover events near you — connect with organizers actively looking for food trucks", status: "planned" },
      { label: "Open to developers — API access for custom integrations", status: "planned" },
      { label: "Beyond food trucks — farmers markets, pop-ups, mobile retail, and more", status: "planned" },
    ],
  },
  {
    number: 8,
    name: "Cost & Profitability",
    tagline: "Revenue is only half the story — know exactly what each event actually puts in your pocket.",
    color: "bg-lime-50 dark:bg-lime-950/20",
    accent: "border-lime-300 dark:border-lime-700",
    badge: "bg-lime-100 text-lime-700 dark:bg-lime-900/50 dark:text-lime-300",
    status: "planned",
    milestones: [
      { label: "Track food cost per event — see if you're hitting your target margin", status: "planned", note: "e.g. 28% food cost as a % of net sales" },
      { label: "Log labor — hours worked, crew size, and wages per event", status: "planned" },
      { label: "Track supplies and overhead — packaging, propane, fuel, commissary kitchen fees", status: "planned" },
      { label: "See actual net profit per event after all costs are subtracted", status: "planned" },
      { label: "Forecasts upgraded to predict profit, not just sales", status: "planned" },
      { label: "Profitability dashboard — which events are actually worth doing?", status: "planned" },
      { label: "Break-even tool — know the minimum sales you need before rolling out", status: "planned" },
      { label: "Cost templates per event type — set your usual costs once, apply them automatically", status: "planned" },
    ],
  },
  {
    number: 10,
    name: "Operator Community",
    tagline: "A home base for the mobile food industry — where operators learn from each other, not from guesswork.",
    color: "bg-teal-50 dark:bg-teal-950/20",
    accent: "border-teal-300 dark:border-teal-700",
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
    status: "planned",
    milestones: [
      { label: "Community forums — ask questions, share tips, learn from operators who've been there", status: "planned" },
      { label: "Event reviews — operators share honest intel on organizers, venues, and crowd quality", status: "planned" },
      { label: "Benchmark sharing — opt in to see how your numbers compare to similar trucks", status: "planned" },
      { label: "Resource library — contracts, pricing guides, health code checklists, and more", status: "planned" },
      { label: "Regional groups — connect with other trucks in your city or market", status: "planned" },
      { label: "Verified operator badges — build trust and reputation within the community", status: "planned" },
    ],
  },
  {
    number: 11,
    name: "The Marketplace",
    tagline: "Book events directly. No middlemen. No commissions. Just your subscription.",
    color: "bg-rose-50 dark:bg-rose-950/20",
    accent: "border-rose-300 dark:border-rose-700",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
    status: "planned",
    milestones: [
      { label: "Event listings — organizers post opportunities directly on VendCast", status: "planned" },
      { label: "Apply to events — submit your truck for consideration in a few taps", status: "planned" },
      { label: "Company catering portal — corporate clients find and book trucks without going through an agency", status: "planned" },
      { label: "Organizer profiles — see ratings, past events, and payment history before you commit", status: "planned" },
      { label: "VendCast data powers the match — your forecast history tells organizers exactly what to expect", status: "planned" },
      { label: "No booking commissions — ever. Your subscription covers everything.", status: "planned", note: "Companies like Food Fleet take 20–30% of your revenue. We don't." },
    ],
  },
  {
    number: 9,
    name: "Brand Redesign",
    tagline: "A fresh look that feels as professional as the system behind it — built for real operators.",
    color: "bg-violet-50 dark:bg-violet-950/20",
    accent: "border-violet-300 dark:border-violet-700",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
    status: "in_progress",
    milestones: [
      { label: "New color palette and typography — clean, modern, and easy on the eyes", status: "in_progress" },
      { label: "Refreshed logo and brand identity", status: "planned" },
      { label: "Updated marketing site — clearer messaging for food truck operators", status: "planned" },
      { label: "Polished dashboard UI — every screen gets a visual pass", status: "planned" },
      { label: "Mobile-first tweaks — tighter layout for phones operators actually use mid-event", status: "planned" },
      { label: "Dark mode refinements — better contrast and color balance", status: "planned" },
    ],
  },
];

const STATS = [
  { label: "Phases completed", value: "7" },
  { label: "Features shipped", value: "50+" },
  { label: "POS integrations", value: "3" },
  { label: "Automated tests", value: "119" },
];

function StatusIcon({ status }: { status: MilestoneStatus }) {
  if (status === "done")
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 mt-0.5" />;
  if (status === "in_progress")
    return <Clock className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />;
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground/30 mt-0.5" />;
}

function PhaseBadge({ status, badge }: { status: MilestoneStatus; badge: string }) {
  if (status === "done")
    return (
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badge}`}>
        Completed
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
        In Progress
      </span>
    );
  return (
    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
      Planned
    </span>
  );
}

export default function RoadmapPage() {
  const completedPhases = PHASES.filter((p) => p.status === "done").length;
  const totalMilestones = PHASES.flatMap((p) => p.milestones).length;
  const doneMilestones = PHASES.flatMap((p) => p.milestones).filter(
    (m) => m.status === "done"
  ).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <TruckIcon className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">VendCast</span>
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Start free trial
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-4 py-1.5 text-sm font-medium mb-6">
            <TruckIcon className="h-4 w-4" />
            Built by a food truck operator, for food truck operators
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            From Guesswork to Real Forecasts
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            VendCast started as one food truck owner&apos;s spreadsheet in St. Louis.
            Here&apos;s every step we&apos;ve taken — and everything coming next.
          </p>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-12 max-w-2xl mx-auto">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-xl border bg-card p-4 text-center">
                <div className="text-3xl font-bold text-primary">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Overall progress */}
          <div className="mt-8 max-w-sm mx-auto">
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>{doneMilestones} milestones completed</span>
              <span>{totalMilestones} total</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(doneMilestones / totalMilestones) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">
              {completedPhases} of {PHASES.length} phases complete
            </p>
          </div>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-8 top-0 bottom-0 w-px bg-border hidden sm:block" />

          <div className="space-y-8">
            {PHASES.map((phase) => (
              <div key={phase.number} className="relative sm:pl-20">
                {/* Phase number bubble */}
                <div className="absolute left-0 top-6 hidden sm:flex h-16 w-16 items-center justify-center rounded-full border-2 border-background bg-card shadow-sm z-10">
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground font-medium leading-none">
                      Phase
                    </div>
                    <div className="text-xl font-bold text-primary leading-none mt-0.5">
                      {phase.number}
                    </div>
                  </div>
                </div>

                {/* Phase card */}
                <div
                  className={`rounded-2xl border-2 ${phase.accent} ${phase.color} overflow-hidden`}
                >
                  {/* Phase header */}
                  <div className="px-6 pt-5 pb-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="sm:hidden text-xs font-semibold text-muted-foreground">
                            Phase {phase.number}
                          </span>
                          <PhaseBadge status={phase.status} badge={phase.badge} />
                        </div>
                        <h2 className="text-xl font-bold">{phase.name}</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {phase.tagline}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Milestones */}
                  <div className="px-6 pb-5">
                    <ul className="space-y-2.5">
                      {phase.milestones.map((m) => (
                        <li key={m.label} className="flex items-start gap-2.5">
                          <StatusIcon status={m.status} />
                          <div>
                            <span
                              className={`text-sm ${
                                m.status === "done"
                                  ? "text-foreground"
                                  : m.status === "in_progress"
                                    ? "text-foreground font-medium"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {m.label}
                            </span>
                            {m.note && (
                              <span className="ml-2 text-xs text-muted-foreground italic">
                                — {m.note}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA footer */}
        <div className="mt-20 text-center rounded-2xl border bg-primary/5 border-primary/20 p-10">
          <TruckIcon className="h-10 w-10 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Ready to forecast your revenue?</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            VendCast is the only platform built specifically for food truck event forecasting.
            14-day free trial, no credit card required.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link
              href="/signup"
              className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Start free trial
            </Link>
            <Link
              href="/tools/calculator"
              className="rounded-md border border-primary/30 px-6 py-3 font-semibold text-primary hover:bg-primary/5 transition-colors"
            >
              Try the calculator
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Built by Julian Engels, owner of Wok-O Taco in St. Louis.{" "}
            <Link href="/" className="text-primary hover:underline">
              vendcast.co
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
