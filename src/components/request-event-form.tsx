"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EVENT_TYPES, US_STATES, US_STATE_NAMES } from "@/lib/constants";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Phase 7a public submit form for event organizers. Posts to
// /api/event-inquiries/submit; on success shows a confirmation
// state inline (no navigation away — keeps the page bookmarkable
// and lets organizers submit a second request if they have one).

export function RequestEventForm() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    matchedOperatorCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const payload = {
      organizer_name: String(form.get("organizer_name") ?? ""),
      organizer_email: String(form.get("organizer_email") ?? ""),
      organizer_phone: String(form.get("organizer_phone") ?? ""),
      organizer_org: String(form.get("organizer_org") ?? ""),
      event_name: String(form.get("event_name") ?? ""),
      event_date: String(form.get("event_date") ?? ""),
      event_start_time: String(form.get("event_start_time") ?? ""),
      event_end_time: String(form.get("event_end_time") ?? ""),
      event_type: String(form.get("event_type") ?? ""),
      expected_attendance:
        form.get("expected_attendance") && form.get("expected_attendance") !== ""
          ? Number(form.get("expected_attendance"))
          : undefined,
      city: String(form.get("city") ?? ""),
      state: String(form.get("state") ?? ""),
      location_details: String(form.get("location_details") ?? ""),
      budget_estimate:
        form.get("budget_estimate") && form.get("budget_estimate") !== ""
          ? Number(form.get("budget_estimate"))
          : undefined,
      notes: String(form.get("notes") ?? ""),
      // Honeypot — visually hidden field with an obscure name. Chrome's
      // built-in autofill silently filled the previous "company_website"
      // because the substring "website" matched its heuristic dictionary,
      // causing every Chrome-with-sync user to silently fail submission.
      // The current field name has no autofill-targetable substring.
      __vc_attestation: String(form.get("__vc_attestation") ?? ""),
    };

    try {
      const res = await fetch("/api/event-inquiries/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Submit failed (HTTP ${res.status})`);
        setSubmitting(false);
        return;
      }
      setDone({ matchedOperatorCount: body.matchedOperatorCount ?? 0 });
      setSubmitting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-brand-teal/30 bg-brand-teal/5 p-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-brand-teal mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Request received</h2>
        <p className="text-muted-foreground mb-6">
          {done.matchedOperatorCount === 0 ? (
            <>We don&apos;t have operators in that city yet — but we saved your request and will reach out if a match comes online.</>
          ) : done.matchedOperatorCount === 1 ? (
            <>Your request is being shared with <strong className="text-foreground">1 operator</strong>. They&apos;ll reach out directly via email.</>
          ) : (
            <>Your request is being shared with <strong className="text-foreground">{done.matchedOperatorCount} operators</strong>. Interested operators will reach out directly via email.</>
          )}
        </p>
        <p className="text-sm text-muted-foreground mb-2">
          Check your inbox for a confirmation. Most operators respond within 24-48 hours.
        </p>
        <p className="text-xs text-muted-foreground mb-6">
          If you don&apos;t hear back within 48 hours, email{" "}
          <a
            href="mailto:support@vendcast.co"
            className="text-brand-teal hover:underline"
          >
            support@vendcast.co
          </a>{" "}
          and we&apos;ll follow up directly.
        </p>
        <Button
          variant="outline"
          onClick={() => setDone(null)}
          className="border-brand-teal/40 hover:bg-brand-teal/10"
        >
          Submit another request
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border bg-card p-6 md:p-8">
      {/* Honeypot — visually hidden CHECKBOX. Chrome's autofill is
          heuristic-based and fills any empty text input near identity
          fields regardless of name (verified: even "__vc_attestation"
          got filled with the user's email). Checkboxes, however, are
          not toggled by autofill engines. Real users never see this;
          bots that auto-check everything fail closed. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" }}>
        <input
          id="__vc_attestation"
          name="__vc_attestation"
          type="checkbox"
          tabIndex={-1}
          defaultChecked={false}
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">About you</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="organizer_name">Your name *</Label>
            <Input id="organizer_name" name="organizer_name" required placeholder="Sarah Johnson" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organizer_email">Email *</Label>
            <Input id="organizer_email" name="organizer_email" type="email" required placeholder="sarah@example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organizer_phone">Phone</Label>
            <Input id="organizer_phone" name="organizer_phone" type="tel" placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organizer_org">Organization</Label>
            <Input id="organizer_org" name="organizer_org" placeholder="XYZ Events / Company name (optional)" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">About the event</legend>

        <div className="space-y-2">
          <Label htmlFor="event_name">Event name</Label>
          <Input id="event_name" name="event_name" placeholder="Smith Wedding Reception · Office Holiday Party · etc." />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="event_date">Date *</Label>
            <Input id="event_date" name="event_date" type="date" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event_start_time">Start time</Label>
            <Input id="event_start_time" name="event_start_time" type="time" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event_end_time">End time</Label>
            <Input id="event_end_time" name="event_end_time" type="time" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="event_type">Event type *</Label>
            <Select name="event_type" required>
              <SelectTrigger id="event_type">
                <SelectValue placeholder="Choose one" />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="expected_attendance">Expected attendance</Label>
            <Input id="expected_attendance" name="expected_attendance" type="number" min={1} placeholder="Approx." />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="city">City *</Label>
            <Input id="city" name="city" required placeholder="St. Louis" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State *</Label>
            <Select name="state" required>
              <SelectTrigger id="state">
                <SelectValue placeholder="Pick" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {US_STATE_NAMES[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="location_details">Venue / location details</Label>
          <Input
            id="location_details"
            name="location_details"
            placeholder="Venue name, full address, parking notes — anything an operator should know"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="budget_estimate">Budget estimate ($)</Label>
          <Input
            id="budget_estimate"
            name="budget_estimate"
            type="number"
            min={0}
            placeholder="Optional, helps operators decide if it's a fit"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="What kind of food are you looking for? Dietary needs? Any special requests?"
          />
        </div>
      </fieldset>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Submitting…
          </>
        ) : (
          "Submit request"
        )}
      </Button>

      <p className="text-xs text-muted-foreground">
        By submitting you&apos;re agreeing to share your contact info with matched operators in your area. Operators reach out directly — VendCast doesn&apos;t share your info with anyone else.
      </p>
    </form>
  );
}
