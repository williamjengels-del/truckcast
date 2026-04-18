"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  ChevronRight,
  ExternalLink,
  Upload,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import type { PosProvider } from "@/lib/database.types";

// ─── Provider definitions ─────────────────────────────────────────────────────

type ProviderOption = {
  id: PosProvider | "skytab" | "other" | "none";
  label: string;
  tagline: string;
  color: string;
};

const PROVIDERS: ProviderOption[] = [
  {
    id: "square",
    label: "Square",
    tagline: "One tap to connect — syncs automatically every night",
    color: "bg-black text-white",
  },
  {
    id: "toast",
    label: "Toast",
    tagline: "Forward your daily email — no app needed",
    color: "bg-red-600 text-white",
  },
  {
    id: "clover",
    label: "Clover",
    tagline: "One tap to connect — syncs automatically every night",
    color: "bg-green-600 text-white",
  },
  {
    id: "sumup",
    label: "SumUp",
    tagline: "One tap to connect — syncs automatically every night",
    color: "bg-blue-600 text-white",
  },
  {
    id: "skytab",
    label: "SkyTab",
    tagline: "Export a CSV each day and upload it here",
    color: "bg-orange-500 text-white",
  },
  {
    id: "other",
    label: "Something else",
    tagline: "Export as CSV and import it — takes 2 minutes",
    color: "bg-muted text-foreground",
  },
  {
    id: "none",
    label: "I don't use a POS",
    tagline: "Log sales manually after each event — takes 30 seconds",
    color: "bg-muted text-foreground",
  },
];

// ─── Step definitions per provider ───────────────────────────────────────────

type Step = {
  title: string;
  detail: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
    external?: boolean;
  };
  autoComplete?: boolean; // step completes itself (e.g. after OAuth redirect back)
};

function getSteps(provider: ProviderOption["id"], toastEmail?: string): Step[] {
  switch (provider) {
    case "square":
    case "clover":
    case "sumup": {
      const name = provider === "square" ? "Square" : provider === "clover" ? "Clover" : "SumUp";
      return [
        {
          title: `Click "Connect ${name}"`,
          detail: `You'll be taken to ${name}'s website to approve access. It takes about 30 seconds.`,
          action: {
            label: `Connect ${name} →`,
            href: `/api/pos/${provider}/authorize`,
          },
        },
        {
          title: `Log in to ${name} and approve`,
          detail: `On ${name}'s page, sign in and click "Allow". You'll be sent straight back here.`,
          autoComplete: true,
        },
        {
          title: "You're connected!",
          detail: `${name} is now linked. Your sales will sync automatically every night — no more manual entry.`,
          autoComplete: true,
        },
      ];
    }

    case "toast":
      return [
        {
          title: "Find your unique forwarding address",
          detail: "Your personal Toast sync email is shown below. Copy it — you'll need it in the next step.",
          // The email is shown inline in the guide component
        },
        {
          title: "Add it as a forwarding address in Gmail",
          detail: "In Gmail: Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address → paste the address → confirm.",
          action: {
            label: "Open Gmail Settings",
            href: "https://mail.google.com/mail/u/0/#settings/fwdandpop",
            external: true,
          },
        },
        {
          title: "Click the verification link",
          detail: "Google sends a confirmation to your Toast sync address. Come back to the POS settings page — you'll see a yellow banner with the link to click.",
          action: {
            label: "Check POS settings for the link →",
            href: "/dashboard/integrations?tab=pos",
          },
        },
        {
          title: "Create a filter to forward Toast emails",
          detail: 'Back in Gmail: Settings → Filters → Create new filter → From: no-reply@toasttab.com → "Forward to" your sync address.',
          action: {
            label: "Open Gmail Filters",
            href: "https://mail.google.com/mail/u/0/#settings/filters",
            external: true,
          },
        },
        {
          title: "You're all set!",
          detail: "Every morning after an event, Toast sends a summary email. VendCast picks it up automatically — your sales log themselves.",
          autoComplete: true,
        },
      ];

    case "skytab":
      return [
        {
          title: "Log in to your SkyTab Lighthouse dashboard",
          detail: "Go to your SkyTab back-office portal and navigate to Reports.",
          action: {
            label: "Open SkyTab Lighthouse",
            href: "https://lighthouse.shift4.com",
            external: true,
          },
        },
        {
          title: "Export your sales report as CSV",
          detail: "Go to Reports → Financial Overview. Set the date range to the event date, then click Export → CSV.",
        },
        {
          title: "Upload it here",
          detail: "Come back to VendCast and upload the CSV. We'll auto-detect SkyTab's columns and match sales to your events.",
          action: {
            label: "Go to Import →",
            href: "/dashboard/integrations?tab=csv-import",
          },
        },
        {
          title: "Repeat after each event",
          detail: "Takes about 2 minutes. Set a morning-after reminder on your phone and it becomes a quick habit.",
          autoComplete: true,
        },
      ];

    case "other":
      return [
        {
          title: "Export your sales data as a CSV",
          detail: "Most POS systems have a 'Reports' or 'Export' option. Look for daily sales totals — one row per day is perfect.",
        },
        {
          title: "Upload it to VendCast",
          detail: "Go to Import Events, upload the CSV, and map the columns. We'll match sales to the right events automatically.",
          action: {
            label: "Go to Import →",
            href: "/dashboard/integrations?tab=csv-import",
          },
        },
        {
          title: "Or log sales manually",
          detail: "After each event, go to Events → find the event → enter your net sales. Takes 30 seconds.",
          action: {
            label: "Go to Events →",
            href: "/dashboard/events?tab=past",
          },
        },
      ];

    case "none":
    default:
      return [
        {
          title: "Log sales after each event",
          detail: "Go to Events → Past Events tab → find the event → click it → enter your net sales. Takes about 30 seconds.",
          action: {
            label: "Go to Events →",
            href: "/dashboard/events?tab=past",
          },
        },
        {
          title: "Set a reminder",
          detail: "The easiest habit: set a recurring phone reminder for the morning after every event. '30 seconds to log sales in VendCast.'",
        },
        {
          title: "Your forecasts get smarter with every event",
          detail: "The more sales you log, the more accurate your revenue predictions get. Even 5–10 events makes a real difference.",
          autoComplete: true,
        },
      ];
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface POSSetupGuideProps {
  /** If user already has a connection, pass it so we can show connected state */
  existingProvider?: PosProvider | null;
  /** Toast sync email for the forwarding step */
  toastEmail?: string;
  /** Called when user finishes the guide */
  onComplete?: () => void;
  /** If true, show a compact version (for settings page header) */
  compact?: boolean;
}

export function POSSetupGuide({
  existingProvider,
  toastEmail,
  onComplete,
  compact = false,
}: POSSetupGuideProps) {
  const [selected, setSelected] = useState<ProviderOption["id"] | null>(
    existingProvider ?? null
  );
  const [currentStep, setCurrentStep] = useState(
    existingProvider ? 999 : 0 // jump to done if already connected
  );

  const steps = selected ? getSteps(selected, toastEmail) : [];
  const isComplete = currentStep >= steps.length;

  // ── Provider selection ──────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="space-y-3">
        {!compact && (
          <p className="text-sm text-muted-foreground">
            Pick your POS and we&apos;ll walk you through connecting it.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setSelected(p.id); setCurrentStep(0); }}
              className="flex items-center gap-3 rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <div className={`h-9 w-9 shrink-0 rounded-lg ${p.color} flex items-center justify-center text-xs font-bold`}>
                {p.label.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="font-semibold text-sm">{p.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.tagline}</div>
              </div>
              <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const providerLabel = PROVIDERS.find((p) => p.id === selected)?.label ?? selected;

  // ── Completed ───────────────────────────────────────────────────────────────
  if (isComplete) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800/30 p-5 flex items-start gap-3">
        <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-green-800 dark:text-green-300">
            {selected === "square" || selected === "clover" || selected === "sumup"
              ? `${providerLabel} is connected — sales sync automatically`
              : selected === "none"
              ? "Got it — log sales after each event"
              : "You're all set up!"}
          </p>
          <p className="text-sm text-green-700 dark:text-green-400 mt-1">
            {selected === "square" || selected === "clover" || selected === "sumup"
              ? "Every night VendCast pulls your sales and matches them to your events."
              : selected === "toast"
              ? "Toast emails will sync automatically. Check back after your next event."
              : "Head to your events page whenever you're ready to log sales."}
          </p>
          {onComplete && (
            <Button
              size="sm"
              className="mt-3"
              onClick={onComplete}
            >
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
          <div className={`h-7 w-7 rounded-lg ${PROVIDERS.find(p => p.id === selected)?.color} flex items-center justify-center text-[11px] font-bold`}>
            {providerLabel.slice(0, 2).toUpperCase()}
          </div>
          <span className="font-semibold text-sm">{providerLabel} setup</span>
        </div>
        <button
          onClick={() => { setSelected(null); setCurrentStep(0); }}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          Change POS
        </button>
      </div>

      {/* Toast email display */}
      {selected === "toast" && currentStep === 0 && toastEmail && (
        <div className="rounded-lg border bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground mb-1">Your forwarding address:</p>
          <code className="text-sm font-mono break-all select-all">{toastEmail}</code>
          <p className="text-xs text-muted-foreground mt-1">Tap to select → copy it</p>
        </div>
      )}

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
                {/* Step indicator */}
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

                  {/* Action button */}
                  {isCurrent && step.action && (
                    <div className="mt-3">
                      {step.action.href ? (
                        step.action.external ? (
                          <a
                            href={step.action.href}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button size="sm" className="gap-1.5">
                              {step.action.label}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                        ) : step.action.href.startsWith("/api/") ? (
                          <Button
                            size="sm"
                            onClick={() => { window.location.href = step.action!.href!; }}
                            className="gap-1.5"
                          >
                            {step.action.label}
                          </Button>
                        ) : (
                          <Link href={step.action.href}>
                            <Button size="sm" className="gap-1.5">
                              {step.action.label}
                            </Button>
                          </Link>
                        )
                      ) : (
                        <Button size="sm" onClick={step.action.onClick}>
                          {step.action.label}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* "Done, next step" button for manual steps */}
                  {isCurrent && !step.autoComplete && (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant={step.action ? "outline" : "default"}
                        onClick={() => setCurrentStep((s) => s + 1)}
                        className="gap-1.5"
                      >
                        {step.action ? "Done, next step" : "Got it, continue"}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}

                  {/* Auto-complete trigger */}
                  {isCurrent && step.autoComplete && idx === steps.length - 1 && (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        onClick={() => setCurrentStep((s) => s + 1)}
                        className="gap-1.5"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Mark complete
                      </Button>
                    </div>
                  )}

                  {/* OAuth return detection */}
                  {isCurrent && step.autoComplete && idx < steps.length - 1 && (
                    <div className="mt-3 flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                      <span className="text-xs text-muted-foreground">
                        Waiting… complete the step above, then come back here
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7 px-2"
                        onClick={() => setCurrentStep((s) => s + 1)}
                      >
                        I did it ✓
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress indicator */}
      <p className="text-xs text-center text-muted-foreground">
        Step {currentStep + 1} of {steps.length}
      </p>
    </div>
  );
}

// ─── Compact trigger for settings page ───────────────────────────────────────

interface POSSetupTriggerProps {
  hasConnection: boolean;
}

export function POSSetupTrigger({ hasConnection }: POSSetupTriggerProps) {
  const [open, setOpen] = useState(false);

  if (hasConnection) return null;

  if (!open) {
    return (
      <div className="max-w-2xl rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-5 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-semibold">Set up automatic sales syncing</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Connect your POS once — sales log themselves after every event.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="shrink-0">
            <Upload className="h-4 w-4 mr-2" />
            Get set up
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl rounded-xl border bg-card p-5 mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Set up automatic sales syncing</p>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <POSSetupGuide compact onComplete={() => setOpen(false)} />
    </div>
  );
}
