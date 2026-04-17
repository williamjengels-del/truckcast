"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";

// ─── Source definitions ───────────────────────────────────────────────────────

type SourceId =
  | "sheets"
  | "excel"
  | "airtable"
  | "square_history"
  | "manual"
  | "fresh";

type Source = {
  id: SourceId;
  label: string;
  tagline: string;
  icon: string;
};

const SOURCES: Source[] = [
  {
    id: "sheets",
    label: "Google Sheets",
    tagline: "Paste your sheet link — we pull it in automatically",
    icon: "GS",
  },
  {
    id: "excel",
    label: "Excel / CSV file",
    tagline: "Export as .csv and upload — takes 2 minutes",
    icon: "XL",
  },
  {
    id: "airtable",
    label: "Airtable",
    tagline: "Export your base as CSV and upload",
    icon: "AT",
  },
  {
    id: "square_history",
    label: "Square (past orders)",
    tagline: "Pull your sales history directly from Square",
    icon: "SQ",
  },
  {
    id: "manual",
    label: "I'll type them in",
    tagline: "Add events one by one — good for a small history",
    icon: "✏",
  },
  {
    id: "fresh",
    label: "Starting from scratch",
    tagline: "No past events yet — I'll add them as I book",
    icon: "✦",
  },
];

// ─── Steps per source ─────────────────────────────────────────────────────────

type Step = {
  title: string;
  detail: string;
  action?: {
    label: string;
    href: string;
    external?: boolean;
  };
  isLast?: boolean;
};

function getSteps(source: SourceId): Step[] {
  switch (source) {
    case "sheets":
      return [
        {
          title: "Make your sheet viewable by anyone with the link",
          detail:
            'In Google Sheets: click Share (top right) → under "General access" change to "Anyone with the link" → set role to Viewer → Done.',
        },
        {
          title: "Copy the link from your browser",
          detail:
            "Just copy the full URL from your address bar — the long one starting with docs.google.com.",
        },
        {
          title: "Go to Import and paste the link",
          detail:
            'On the Import page, choose "Google Sheets", paste the link, and click Import. We\'ll pull your data and walk you through matching the columns.',
          action: {
            label: "Go to Import →",
            href: "/dashboard/events/import",
          },
          isLast: true,
        },
      ];

    case "excel":
      return [
        {
          title: "Export your spreadsheet as a CSV file",
          detail:
            'In Excel: File → Save As → choose "CSV (Comma delimited)". In Google Sheets: File → Download → "Comma-separated values (.csv)".',
        },
        {
          title: "Upload the CSV file",
          detail:
            "Go to Import, choose \"Upload CSV\", and drag your file in. We'll auto-detect your columns and let you review before anything is saved.",
          action: {
            label: "Go to Import →",
            href: "/dashboard/events/import",
          },
          isLast: true,
        },
      ];

    case "airtable":
      return [
        {
          title: "Export your Airtable base as CSV",
          detail:
            'In Airtable: open the table with your events → click the grid view menu (···) → Download CSV. This exports every row in that view.',
        },
        {
          title: "Upload the CSV file",
          detail:
            "Go to Import, upload the file, and match your Airtable columns to VendCast fields. Airtable exports clean CSVs — it usually auto-maps perfectly.",
          action: {
            label: "Go to Import →",
            href: "/dashboard/events/import",
          },
          isLast: true,
        },
      ];

    case "square_history":
      return [
        {
          title: "Connect your Square account first",
          detail:
            "VendCast pulls sales directly from Square — no export needed. Connect Square from the POS settings page, then use the sync feature to pull your history.",
          action: {
            label: "Go to POS Settings →",
            href: "/dashboard/settings/pos",
          },
        },
        {
          title: "Run a historical sync",
          detail:
            'Once connected, click "Sync" on the Square card and choose a custom date range to pull past sales. VendCast matches them to your events automatically.',
          isLast: true,
        },
      ];

    case "manual":
      return [
        {
          title: "Go to your Events page",
          detail:
            'Click "Add Event" for each past event you want to log. Focus on events where you know the sales — those are what make your forecasts accurate.',
          action: {
            label: "Go to Events →",
            href: "/dashboard/events",
          },
        },
        {
          title: "Start with your most recent events",
          detail:
            "Work backwards from today. Recent events carry the most weight in your forecasts — 10 recent events beats 50 old ones.",
          isLast: true,
        },
      ];

    case "fresh":
    default:
      return [
        {
          title: "Add events as you book them",
          detail:
            'Go to Events → "Add Event" whenever you confirm a new booking. Fill in the name, date, location, and event type.',
          action: {
            label: "Go to Events →",
            href: "/dashboard/events",
          },
        },
        {
          title: "Log your sales after each event",
          detail:
            "The morning after an event, come back and enter your net sales. This is what trains your forecasts — the more you log, the sharper they get.",
        },
        {
          title: "Your first forecast unlocks fast",
          detail:
            "Even one logged event gives you a baseline. By your 5th event, VendCast starts recognizing patterns. By your 10th, forecasts get genuinely useful.",
          isLast: true,
        },
      ];
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DataImportGuideProps {
  onComplete?: () => void;
}

export function DataImportGuide({ onComplete }: DataImportGuideProps) {
  const [selected, setSelected] = useState<SourceId | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  const steps = selected ? getSteps(selected) : [];
  const isComplete = selected !== null && currentStep >= steps.length;

  // ── Source selection ────────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Where do you currently keep track of your events?
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSelected(s.id); setCurrentStep(0); }}
              className="flex items-center gap-3 rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                {s.icon}
              </div>
              <div>
                <div className="font-semibold text-sm">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.tagline}</div>
              </div>
              <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const sourceLabel = SOURCES.find((s) => s.id === selected)?.label ?? selected;

  // ── Completed ───────────────────────────────────────────────────────────────
  if (isComplete) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800/30 p-5 flex items-start gap-3">
        <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-green-800 dark:text-green-300">
            {selected === "fresh"
              ? "Got it — add events as you book them"
              : selected === "manual"
              ? "Ready to go — add your events one by one"
              : "You're all set to import your events"}
          </p>
          <p className="text-sm text-green-700 dark:text-green-400 mt-1">
            {selected === "fresh" || selected === "manual"
              ? "The more events you log, the more accurate your forecasts get. Every event counts."
              : "Head to the import page whenever you're ready — your data will be waiting."}
          </p>
          {onComplete && (
            <Button size="sm" className="mt-3" onClick={onComplete}>
              Continue <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Step-by-step guide ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{sourceLabel}</span>
        </div>
        <button
          onClick={() => { setSelected(null); setCurrentStep(0); }}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          Change source
        </button>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, idx) => {
          const isDone = idx < currentStep;
          const isCurrent = idx === currentStep;

          return (
            <div
              key={idx}
              className={`rounded-xl border p-4 transition-all ${
                isCurrent
                  ? "border-primary bg-primary/5 shadow-sm"
                  : isDone
                  ? "border-green-200 bg-green-50/50 dark:bg-green-950/10 dark:border-green-800/20"
                  : "border-border bg-muted/20 opacity-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isDone
                    ? "bg-green-500 text-white"
                    : isCurrent
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {isDone ? <CheckCircle className="h-4 w-4" /> : idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${!isCurrent && !isDone ? "text-muted-foreground" : ""}`}>
                    {step.title}
                  </p>
                  {isCurrent && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {step.detail}
                    </p>
                  )}

                  {isCurrent && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {step.action && (
                        step.action.external ? (
                          <a href={step.action.href} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline" className="gap-1.5">
                              {step.action.label}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                        ) : (
                          <Link href={step.action.href}>
                            <Button size="sm" variant="outline" className="gap-1.5">
                              {step.action.label}
                            </Button>
                          </Link>
                        )
                      )}
                      <Button
                        size="sm"
                        onClick={() => {
                          if (step.isLast) {
                            setCurrentStep(steps.length);
                          } else {
                            setCurrentStep((s) => s + 1);
                          }
                        }}
                        className="gap-1.5"
                      >
                        {step.isLast ? (
                          <><CheckCircle className="h-3.5 w-3.5" /> Done</>
                        ) : (
                          <>Got it <ChevronRight className="h-3.5 w-3.5" /></>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Step {currentStep + 1} of {steps.length}
      </p>
    </div>
  );
}

// ─── Trigger for events page / import page header ─────────────────────────────

interface DataImportTriggerProps {
  hasEvents: boolean;
}

export function DataImportTrigger({ hasEvents }: DataImportTriggerProps) {
  const [open, setOpen] = useState(false);

  if (hasEvents) return null;

  if (!open) {
    return (
      <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-5 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-semibold">Get your events into VendCast</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Google Sheets, Excel, Airtable, or manual — we&apos;ll walk you through it.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="shrink-0">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Get started
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5 mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Get your events into VendCast</p>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <DataImportGuide onComplete={() => setOpen(false)} />
    </div>
  );
}
