"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveAfterEventSummary } from "@/app/dashboard/events/actions";

interface Props {
  eventId: string;
  eventName: string;
  /** Operator-local end time HH:MM AM/PM display (parent formats). */
  endTimeDisplay: string | null;
  /** Pre-fill final_sales with the current event.net_sales when set. */
  initialNetSales: number | null;
}

/**
 * After-event summary form. Surfaces on the day-of card when an
 * event has just ended and after_event_summary is null.
 *
 * Non-blocking — operator can dismiss with "Skip" and fill from the
 * events page later.
 *
 * Optimistic dismiss: clicking Skip hides the prompt locally so the
 * card doesn't re-render the form on the next dashboard refresh.
 * That's a UI hint only — the underlying after_event_summary stays
 * null on the server until the operator actually saves.
 */
export function AfterEventSummary({
  eventId,
  eventName,
  endTimeDisplay,
  initialNetSales,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [finalSales, setFinalSales] = useState<string>(
    initialNetSales !== null ? String(initialNetSales) : ""
  );
  const [wrapUpNote, setWrapUpNote] = useState("");
  const [whatIdChange, setWhatIdChange] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (dismissed || saved) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const finalSalesNum =
      finalSales.trim() === "" ? null : Number(finalSales);
    if (finalSalesNum !== null && Number.isNaN(finalSalesNum)) {
      setError("Final sales must be a number");
      return;
    }
    startTransition(async () => {
      try {
        await saveAfterEventSummary(eventId, {
          final_sales: finalSalesNum,
          wrap_up_note: wrapUpNote.trim() || null,
          what_id_change: whatIdChange.trim() || null,
        });
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-brand-orange/40 bg-brand-orange/5 p-4 space-y-3"
      data-testid="day-of-event-after-summary"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-orange">
            Wrap up · {eventName}
          </p>
          {endTimeDisplay && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Ended {endTimeDisplay}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Dismiss wrap-up form"
          data-testid="day-of-event-after-summary-skip"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="final_sales" className="text-xs">
            Final sales
          </Label>
          <Input
            id="final_sales"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={finalSales}
            onChange={(e) => setFinalSales(e.target.value)}
            placeholder="0.00"
            disabled={pending}
          />
          <p className="text-xs text-muted-foreground">
            Updates the event&apos;s net_sales if entered.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wrap_up_note" className="text-xs">
            Wrap-up note
          </Label>
          <Textarea
            id="wrap_up_note"
            value={wrapUpNote}
            onChange={(e) => setWrapUpNote(e.target.value)}
            placeholder="How'd it go?"
            rows={2}
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="what_id_change" className="text-xs">
          What would I do differently?
        </Label>
        <Textarea
          id="what_id_change"
          value={whatIdChange}
          onChange={(e) => setWhatIdChange(e.target.value)}
          placeholder="Stock more bulgogi · text the org earlier · skip the upsell..."
          rows={2}
          disabled={pending}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setDismissed(true)}
          disabled={pending}
        >
          Skip for now
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className="gap-1.5"
          data-testid="day-of-event-after-summary-save"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {pending ? "Saving…" : "Save wrap-up"}
        </Button>
      </div>
    </form>
  );
}
