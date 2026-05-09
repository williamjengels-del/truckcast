"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, X, Check, Loader2 } from "lucide-react";
import type { Event } from "@/lib/database.types";

// A Toast daily-summary email that arrived for a date with no booked
// event on the operator's calendar. Most commonly a catering deposit
// paid on date X for an event on date Y (Y usually weeks later), or a
// remainder payment after an event. Rendered inside the Toast section
// of the integrations page so operators can route these payments
// manually rather than silently losing them.

interface UnmatchedPayment {
  id: string;
  source: string;
  reported_date: string;
  net_sales: number;
  raw_subject: string | null;
  created_at: string;
}

function formatCurrency(n: number): string {
  return `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UnmatchedToastInbox() {
  const [payments, setPayments] = useState<UnmatchedPayment[] | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPayments = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/toast/unmatched", { cache: "no-store" });
      if (!res.ok) {
        setError(`Failed to load inbox (${res.status})`);
        return;
      }
      const body = await res.json();
      setPayments(body.payments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inbox");
    }
  }, []);

  const loadEvents = useCallback(async () => {
    // Client-side Supabase query — RLS limits to the caller's own rows.
    // Pull a wide window (last 6 months through next 12 months) so
    // both deposit-ahead and remainder-after patterns are covered in
    // the dropdown. Plenty of room without paginating.
    const supabase = createClient();
    const today = new Date();
    const from = new Date(today);
    from.setMonth(from.getMonth() - 6);
    const to = new Date(today);
    to.setMonth(to.getMonth() + 12);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const { data, error: dbError } = await supabase
      .from("events")
      .select("id, event_name, event_date, event_mode, net_sales, invoice_revenue, booked, cancellation_reason")
      .gte("event_date", fromStr)
      .lte("event_date", toStr)
      .order("event_date", { ascending: false });

    if (dbError) {
      setError(`Failed to load events: ${dbError.message}`);
      return;
    }
    setEvents((data ?? []) as Event[]);
  }, []);

  useEffect(() => {
    // Lint flags this as setState-in-effect — the loaders end up
    // calling setState async after their fetches resolve. This is the
    // canonical "load data on mount" pattern; the actual setStates
    // happen on the post-fetch microtask, not synchronously inside the
    // effect, so no real cascading-render risk.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical mount-time data load
    loadPayments();
    loadEvents();
  }, [loadPayments, loadEvents]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (payments === null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Toast inbox…
      </div>
    );
  }

  if (payments.length === 0) {
    return null; // empty state intentionally invisible — don't clutter the tab
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5">
      <div className="flex items-center gap-2 border-b border-warning/40 px-4 py-2.5">
        <AlertCircle className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-semibold text-warning">
          Toast payments waiting for review
        </h3>
        <Badge variant="outline" className="ml-auto border-warning/50 text-warning">
          {payments.length}
        </Badge>
      </div>
      <div className="divide-y divide-warning/30">
        {payments.map((payment) => (
          <UnmatchedPaymentRow
            key={payment.id}
            payment={payment}
            events={events ?? []}
            onResolved={loadPayments}
          />
        ))}
      </div>
      <div className="border-t border-warning/40 px-4 py-2 text-xs text-warning">
        Toast reported sales for these dates but no booked event matched. Assign to the
        event the payment belongs to (deposits usually precede the event date by weeks;
        remainders come after), or dismiss if it&apos;s a duplicate.
      </div>
    </div>
  );
}

function UnmatchedPaymentRow({
  payment,
  events,
  onResolved,
}: {
  payment: UnmatchedPayment;
  events: Event[];
  onResolved: () => void | Promise<void>;
}) {
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [busy, setBusy] = useState<"assign" | "dismiss" | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Sort events: closest-to-payment-date first, so operators can eyeball
  // "this deposit is probably for that upcoming wedding 3 weeks out"
  // without scrolling. Keep all events in the list — operators know
  // their own catering calendar, don't prefilter by date window.
  const sortedEvents = useMemo(() => {
    const paymentTime = new Date(payment.reported_date + "T00:00:00").getTime();
    return [...events]
      .filter((e) => !e.cancellation_reason) // hide cancelled events from the dropdown
      .sort((a, b) => {
        const da = Math.abs(new Date(a.event_date + "T00:00:00").getTime() - paymentTime);
        const db = Math.abs(new Date(b.event_date + "T00:00:00").getTime() - paymentTime);
        return da - db;
      });
  }, [events, payment.reported_date]);

  async function handleAssign() {
    if (!selectedEventId) return;
    setBusy("assign");
    setRowError(null);
    try {
      const res = await fetch(`/api/pos/toast/unmatched/${payment.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_to_event", eventId: selectedEventId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRowError(body?.error ?? `Assign failed (${res.status})`);
        setBusy(null);
        return;
      }
      await onResolved();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Assign failed");
      setBusy(null);
    }
  }

  async function handleDismiss() {
    setBusy("dismiss");
    setRowError(null);
    try {
      const res = await fetch(`/api/pos/toast/unmatched/${payment.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRowError(body?.error ?? `Dismiss failed (${res.status})`);
        setBusy(null);
        return;
      }
      await onResolved();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Dismiss failed");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{formatCurrency(payment.net_sales)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{formatDate(payment.reported_date)}</span>
        </div>
        {payment.raw_subject && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {payment.raw_subject}
          </p>
        )}
        {rowError && (
          <p className="text-xs text-destructive mt-1">{rowError}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Select value={selectedEventId} onValueChange={(v) => setSelectedEventId(v ?? "")}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Assign to event…" />
          </SelectTrigger>
          <SelectContent>
            {sortedEvents.length === 0 && (
              <SelectItem value="__empty__" disabled>
                No events in window
              </SelectItem>
            )}
            {sortedEvents.map((event) => (
              <SelectItem key={event.id} value={event.id}>
                {formatDate(event.event_date)} — {event.event_name}
                {(event.event_mode ?? "food_truck") === "catering" && " (catering)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={handleAssign}
          disabled={!selectedEventId || busy !== null}
        >
          {busy === "assign" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Check className="h-4 w-4 mr-1" />
              Assign
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          disabled={busy !== null}
          title="Dismiss — don't attribute this payment to any event"
        >
          {busy === "dismiss" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
