import type { Metadata } from "next";
import Link from "next/link";
import { TruckIcon, CheckCircle2, Circle, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "TruckCast Roadmap — Built for Food Truck Operators",
  description: "See how TruckCast went from an Airtable spreadsheet to a full AI-powered forecasting platform for food truck operators.",
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
    tagline: "Manual Airtable tracking. No forecasting. No scale.",
    color: "bg-slate-50 dark:bg-slate-900/30",
    accent: "border-slate-300 dark:border-slate-700",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    status: "done",
    milestones: [
      { label: "Wok-O Taco tracked events manually in Airtable", status: "done" },
      { label: "No way to forecast revenue for upcoming bookings", status: "done" },
      { label: "Insight: the system worked — but couldn't scale to other operators", status: "done" },
      { label: "Decision: build a generalized multi-tenant SaaS version", status: "done" },
    ],
  },
  {
    number: 1,
    name: "Foundation",
    tagline: "Scaffold, database, auth — production-ready from day one.",
    color: "bg-blue-50 dark:bg-blue-950/20",
    accent: "border-blue-300 dark:border-blue-700",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    status: "done",
    milestones: [
      { label: "Next.js 14 App Router scaffold on Vercel", status: "done" },
      { label: "Supabase PostgreSQL with Row Level Security on all tables", status: "done" },
      { label: "Email + Google OAuth authentication", status: "done" },
      { label: "Full database schema — events, profiles, performance, forecasts", status: "done" },
      { label: "Tailwind CSS + shadcn/ui component system", status: "done" },
    ],
  },
  {
    number: 2,
    name: "Core Product",
    tagline: "Event management, fee calculator, and a validated forecast engine.",
    color: "bg-violet-50 dark:bg-violet-950/20",
    accent: "border-violet-300 dark:border-violet-700",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
    status: "done",
    milestones: [
      { label: "Event CRUD — create, edit, delete, bulk import via CSV", status: "done" },
      { label: "Fee calculator — flat, percent, pre-settled, day-rate", status: "done" },
      { label: "4-level hierarchical forecast engine", status: "done", note: "59% MAPE on high-confidence events" },
      { label: "Weather + day-of-week + attendance coefficients", status: "done" },
      { label: "Per-user coefficient calibration (auto-improves with history)", status: "done" },
      { label: "Dashboard with KPIs, charts, and revenue trends", status: "done" },
      { label: "Event performance analytics — avg, median, consistency, YoY", status: "done" },
    ],
  },
  {
    number: 3,
    name: "POS Integrations",
    tagline: "Automatic sales sync from Square, Clover, and Toast.",
    color: "bg-emerald-50 dark:bg-emerald-950/20",
    accent: "border-emerald-300 dark:border-emerald-700",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    status: "done",
    milestones: [
      { label: "Square OAuth integration — auto-sync daily orders", status: "done" },
      { label: "Clover OAuth integration", status: "done" },
      { label: "Toast email parser — paste or auto-forward daily summaries", status: "done" },
      { label: "Cloudflare Email Worker routing for Toast auto-sync", status: "done" },
      { label: "Multi-location support with location selection", status: "done" },
      { label: "Intelligent event matching — splits multi-event days by forecast share", status: "done" },
    ],
  },
  {
    number: 4,
    name: "Go to Market",
    tagline: "VendCast brand, Stripe billing, beta program, and public launch.",
    color: "bg-orange-50 dark:bg-orange-950/20",
    accent: "border-orange-300 dark:border-orange-700",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    status: "done",
    milestones: [
      { label: "VendCast parent brand — vendcast.co domain live", status: "done" },
      { label: "Stripe billing — Starter / Pro / Premium tiers", status: "done" },
      { label: "14-day free trial with automated expiry emails", status: "done" },
      { label: "Beta invite code system for early access", status: "done" },
      { label: "Resend transactional email (welcome, trial warnings, expiry)", status: "done" },
      { label: "Public forecast calculator tool — no login required", status: "done" },
      { label: "What-If analysis panel on forecast page", status: "done" },
      { label: "Admin panel — user visibility, booked/unbooked events", status: "done" },
    ],
  },
  {
    number: 5,
    name: "Architecture & Quality",
    tagline: "Clean service layer, unified contracts, and regression tests.",
    color: "bg-cyan-50 dark:bg-cyan-950/20",
    accent: "border-cyan-300 dark:border-cyan-700",
    badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
    status: "done",
    milestones: [
      { label: "Unified matchAndUpdateSales — eliminated duplicate cron logic", status: "done" },
      { label: "Shared recalculate-service — removed inline copies from all routes", status: "done" },
      { label: "updateSyncStatus accepts service client — consistent across POS providers", status: "done" },
      { label: "Vitest test suite — 17 passing regression tests", status: "done" },
      { label: "User profile upsert on signup + OAuth callback — no more missing profiles", status: "done" },
    ],
  },
  {
    number: 6,
    name: "Journey Orchestration",
    tagline: "Guiding every user through the right experience for their stage.",
    color: "bg-pink-50 dark:bg-pink-950/20",
    accent: "border-pink-300 dark:border-pink-700",
    badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
    status: "in_progress",
    milestones: [
      { label: "User journey state engine — new → building → logging → calibrating → calibrated", status: "done" },
      { label: "State-aware dashboard callouts with per-state dismissal", status: "done" },
      { label: "Enhanced setup progress with sales-logged milestone", status: "done" },
      { label: "Welcome tour (6-slide onboarding flow)", status: "done" },
      { label: "Role differentiation — owner vs crew", status: "planned" },
      { label: "Mobile-responsive dashboard", status: "planned" },
    ],
  },
  {
    number: 7,
    name: "Growth & Intelligence",
    tagline: "Organizer scoring, follower engine, and multi-truck support.",
    color: "bg-amber-50 dark:bg-amber-950/20",
    accent: "border-amber-300 dark:border-amber-700",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    status: "planned",
    milestones: [
      { label: "Organizer scoring — rank contacts by revenue quality", status: "planned" },
      { label: "Follower / fan engagement engine (Premium)", status: "planned" },
      { label: "Multi-truck support — manage multiple vehicles under one account", status: "planned" },
      { label: "Vendor-to-vendor event discovery network", status: "planned" },
      { label: "Public API for third-party integrations", status: "planned" },
      { label: "Expand beyond food trucks — mobile retail, pop-ups, markets", status: "planned" },
    ],
  },
];

const STATS = [
  { label: "Phases completed", value: "6" },
  { label: "Features shipped", value: "40+" },
  { label: "POS integrations", value: "3" },
  { label: "Regression tests", value: "17" },
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
            <div className="flex flex-col leading-none">
              <span className="font-bold text-lg">TruckCast</span>
              <span className="text-[9px] text-muted-foreground font-medium tracking-wide">
                by VendCast
              </span>
            </div>
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
            From Airtable to AI Forecasting
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            The full story of how TruckCast was built — every phase, every milestone,
            and where we're headed next.
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
            TruckCast is the only platform built specifically for food truck event forecasting.
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
