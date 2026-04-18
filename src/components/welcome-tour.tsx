"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  X,
  ArrowRight,
  ArrowLeft,
  Calendar,
  DollarSign,
  TrendingUp,
  Upload,
  CheckCircle2,
  BarChart3,
} from "lucide-react";

// Intentional: legacy key from pre-rename. Renaming would re-trigger the tour
// for every existing user. Bump to vendcast_tour_v2_done when we ship a
// materially new tour, not as collateral from a brand rename.
const STORAGE_KEY = "truckcast_tour_v1_done";

// ─── Slide definitions ──────────────────────────────────────────────────────

const SLIDES = [
  {
    id: "welcome",
    icon: null,
    illustration: "truck",
    title: "Welcome to VendCast 🚚",
    body: "You're a few steps away from your first revenue forecast. Here's a quick look at how it works — takes about 60 seconds.",
    cta: "Show me around",
    link: null,
  },
  {
    id: "events",
    icon: Calendar,
    illustration: "calendar",
    title: "Events are the foundation",
    body: "Every booking — past or future — lives here. Add upcoming events to get forecasts, and log past events to build your history.",
    hint: "→ Find it in the sidebar under Events",
    cta: "Got it",
    link: null,
  },
  {
    id: "import",
    icon: Upload,
    illustration: "upload",
    title: "Bring in your history fast",
    body: "Already have events in Airtable, Square, or a spreadsheet? Import them as a CSV. VendCast auto-detects your columns — no reformatting needed.",
    hint: "→ Sidebar → Import CSV",
    cta: "Makes sense",
    link: null,
  },
  {
    id: "sales",
    icon: DollarSign,
    illustration: "dollar",
    title: "Log sales after each event",
    body: "After an event wraps up, enter what you made. VendCast uses real sales data to calibrate your forecasts over time. The more events you log, the sharper it gets.",
    hint: "→ Events → click any past event → Enter Sales",
    cta: "Got it",
    link: null,
  },
  {
    id: "forecasts",
    icon: TrendingUp,
    illustration: "forecast",
    title: "Know what to expect",
    body: "With 10+ past events, VendCast generates revenue forecasts for each upcoming booking — based on event type, weather, location, and your own history.",
    hint: "→ Sidebar → Forecasts",
    cta: "Almost there",
    link: null,
  },
  {
    id: "done",
    icon: CheckCircle2,
    illustration: "check",
    title: "You're all set",
    body: "Here's your quick-start checklist to get your first forecast:",
    cta: "Go to dashboard",
    link: "/dashboard",
  },
] as const;

// ─── Illustrations (CSS-only, no images needed) ──────────────────────────────

function Illustration({ type }: { type: string }) {
  const base = "w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6";

  switch (type) {
    case "truck":
      return (
        <div className={`${base} bg-orange-100`}>
          <span className="text-5xl">🚚</span>
        </div>
      );
    case "calendar":
      return (
        <div className={`${base} bg-blue-100`}>
          <Calendar className="h-10 w-10 text-blue-600" />
        </div>
      );
    case "upload":
      return (
        <div className={`${base} bg-purple-100`}>
          <Upload className="h-10 w-10 text-purple-600" />
        </div>
      );
    case "dollar":
      return (
        <div className={`${base} bg-green-100`}>
          <DollarSign className="h-10 w-10 text-green-600" />
        </div>
      );
    case "forecast":
      return (
        <div className={`${base} bg-indigo-100`}>
          <BarChart3 className="h-10 w-10 text-indigo-600" />
        </div>
      );
    case "check":
      return (
        <div className={`${base} bg-orange-100`}>
          <CheckCircle2 className="h-10 w-10 text-orange-500" />
        </div>
      );
    default:
      return null;
  }
}

// ─── Checklist for the final slide ──────────────────────────────────────────

const CHECKLIST = [
  { label: "Import or add 5+ past events", href: "/dashboard/integrations?tab=csv-import", action: "Import CSV" },
  { label: "Add an upcoming booking", href: "/dashboard/events?new=true", action: "Add Event" },
  { label: "Check your first forecast", href: "/dashboard/insights?tab=forecasts", action: "View Forecasts" },
];

// ─── Main component ──────────────────────────────────────────────────────────

interface WelcomeTourProps {
  /** Force open (e.g. from help button) */
  forceOpen?: boolean;
  onClose?: () => void;
}

export function WelcomeTour({ forceOpen = false, onClose }: WelcomeTourProps) {
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const router = useRouter();

  // Auto-show on first visit
  useEffect(() => {
    if (forceOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlide(0);
      return;
    }
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      // Small delay so the dashboard loads first
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, [forceOpen]);

  function goTo(next: number, dir: "forward" | "back") {
    if (animating) return;
    setDirection(dir);
    setAnimating(true);
    setTimeout(() => {
      setSlide(next);
      setAnimating(false);
    }, 180);
  }

  function handleClose() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
    onClose?.();
  }

  function handleCta() {
    const current = SLIDES[slide];
    if (slide === SLIDES.length - 1) {
      handleClose();
      if (current.link) router.push(current.link);
    } else {
      goTo(slide + 1, "forward");
    }
  }

  if (!open) return null;

  const current = SLIDES[slide];
  const isLast = slide === SLIDES.length - 1;
  const progress = slide / (SLIDES.length - 1);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Card */}
      <div
        className={`relative bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-all duration-200 ${
          animating
            ? direction === "forward"
              ? "opacity-0 translate-x-4"
              : "opacity-0 -translate-x-4"
            : "opacity-100 translate-x-0"
        }`}
      >
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-1 bg-primary transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-8 pt-6">
          {/* Slide counter */}
          <p className="text-xs text-muted-foreground text-center mb-4">
            {slide + 1} of {SLIDES.length}
          </p>

          {/* Illustration */}
          <Illustration type={current.illustration} />

          {/* Content */}
          <div className="text-center space-y-3">
            <h2 className="text-xl font-bold">{current.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>

            {"hint" in current && current.hint && (
              <p className="text-xs font-medium text-primary bg-primary/8 rounded-md px-3 py-2 inline-block">
                {current.hint}
              </p>
            )}

            {/* Final slide checklist */}
            {isLast && (
              <div className="text-left space-y-2 mt-4">
                {CHECKLIST.map((item) => (
                  <div
                    key={item.href}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 rounded border-2 border-muted-foreground/30 shrink-0" />
                      <span className="text-sm">{item.label}</span>
                    </div>
                    <button
                      onClick={() => { handleClose(); router.push(item.href); }}
                      className="text-xs font-medium text-primary hover:underline shrink-0"
                    >
                      {item.action} →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 gap-3">
            <div className="flex gap-1">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i, i > slide ? "forward" : "back")}
                  className={`rounded-full transition-all duration-200 ${
                    i === slide
                      ? "w-5 h-2 bg-primary"
                      : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {slide > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => goTo(slide - 1, "back")}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              )}
              {slide === 0 && (
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  Skip
                </Button>
              )}
              <Button size="sm" onClick={handleCta}>
                {isLast ? "Go to dashboard" : current.cta}
                {!isLast && <ArrowRight className="h-4 w-4 ml-1" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
