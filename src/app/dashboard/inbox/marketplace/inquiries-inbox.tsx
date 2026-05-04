"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { EVENT_TYPES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  MapPin,
  Users,
  DollarSign,
  Mail,
  Phone,
  CheckCircle2,
  X,
  MessageSquare,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Radar,
} from "lucide-react";
import type { EventInquiry, EventInquiryAction } from "@/lib/database.types";

interface Props {
  initialInquiries: EventInquiry[];
  currentUserId: string;
  // Map of inquiry_id → event_id for inquiries this user has already
  // claimed. Populated by the server-side page; the component layers
  // freshly-claimed event IDs from the action-route response on top.
  initialClaimedEventByInquiry?: Record<string, string>;
  // Map of inquiry_id → array of conflicting event names already on
  // the operator's calendar for that date. Empty / missing = no
  // conflict. Self-conflicts (the inquiry's own auto-created planning
  // event) are excluded server-side.
  conflictsByInquiry?: Record<string, string[]>;
  // Server-loaded per-operator notes per inquiry. Hydrates the
  // textareas so the operator sees their own notes immediately
  // without a client-side round trip.
  initialOperatorNotes?: Record<string, string>;
  // Operator's business_name for the email-template signature.
  // Empty string is acceptable — the template falls back to a
  // neutral phrasing.
  operatorBusinessName?: string;
  // Engagement signal copy per inquiry (e.g. "On a few operators'
  // radars"). Absent / empty = no signal — render nothing for that
  // card. Computed server-side; fresh on each load.
  engagementSignalByInquiry?: Record<string, string>;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  function fmt(t: string | null): string {
    if (!t) return "";
    // Database returns "HH:MM:SS" — show "H:MM AM/PM"
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  }
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt(start ?? end);
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Mailto template — short by design (most clients balk past ~2000
// chars). Interpolates inquiry + operator context so the operator can
// hit Send (or edit first) without writing from scratch. URL-encoded
// at usage site.
function buildEmailTemplate(args: {
  organizerName: string;
  eventType: string;
  eventDate: string;
  city: string;
  state: string;
  operatorBusinessName: string;
}): { subject: string; body: string } {
  const dateText = new Date(args.eventDate + "T00:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric" }
  );
  const sig = args.operatorBusinessName || "Your VendCast operator";
  const subject = `Re: your VendCast event request (${dateText})`;
  const body = [
    `Hi ${args.organizerName},`,
    "",
    `Thanks for the event request through VendCast. I'm interested in your ${args.eventType} on ${dateText} in ${args.city}, ${args.state}, and would love to discuss the details.`,
    "",
    "A few quick questions to put together the best plan:",
    "  - Final guest count and serving window?",
    "  - Any dietary needs or specific cuisine direction?",
    "  - Venue setup — power, water, parking access?",
    "",
    "Looking forward to hearing more.",
    "",
    sig,
  ].join("\n");
  return { subject, body };
}

export function InquiriesInbox({
  initialInquiries,
  currentUserId,
  initialClaimedEventByInquiry = {},
  conflictsByInquiry = {},
  initialOperatorNotes = {},
  operatorBusinessName = "",
  engagementSignalByInquiry = {},
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "responded">("open");
  // Event-type filter, URL-persisted via ?event_type=. Empty value =
  // "All event types" (no filter). Persisting in URL means a refresh
  // and a shared link both keep the operator's chosen scope.
  const eventTypeFilter = searchParams.get("event_type") ?? "";
  // Active types present in this operator's actual inquiry set —
  // dropdown shows only event types they've actually received, not
  // the entire EVENT_TYPES catalog. Avoids dead options.
  const availableEventTypes = useMemo(() => {
    const present = new Set<string>();
    for (const inq of inquiries) present.add(inq.event_type);
    return EVENT_TYPES.filter((t) => present.has(t));
  }, [inquiries]);
  function handleEventTypeChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("event_type", next);
    else params.delete("event_type");
    const qs = params.toString();
    router.replace(qs ? `/dashboard/inbox/marketplace?${qs}` : `/dashboard/inbox/marketplace`);
  }
  const [claimedEventByInquiry, setClaimedEventByInquiry] = useState(
    initialClaimedEventByInquiry
  );
  // Per-inquiry operator notes. Server-loaded initial map; local
  // edits debounce-save to /api/event-inquiries/notes.
  const [operatorNotes, setOperatorNotes] =
    useState<Record<string, string>>(initialOperatorNotes);
  const noteSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const NOTES_DEBOUNCE_MS = 800;
  function handleNotesChange(inquiryId: string, value: string) {
    setOperatorNotes((prev) => ({ ...prev, [inquiryId]: value }));
    if (noteSaveTimersRef.current[inquiryId]) {
      clearTimeout(noteSaveTimersRef.current[inquiryId]);
    }
    noteSaveTimersRef.current[inquiryId] = setTimeout(() => {
      fetch("/api/event-inquiries/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryId, notes: value }),
      }).catch(() => {
        // Silent — operator's text stays in local state. On reload,
        // server-side initialOperatorNotes wins; if the save was
        // genuinely lost the operator will notice and retype.
      });
      delete noteSaveTimersRef.current[inquiryId];
    }, NOTES_DEBOUNCE_MS);
  }
  // Flush any pending note save on unmount via sendBeacon — same
  // pattern as mark-viewed so a fast tab-close doesn't lose typing.
  useEffect(() => {
    const timersRef = noteSaveTimersRef;
    return () => {
      const pending = Object.entries(timersRef.current);
      for (const [inquiryId, timer] of pending) {
        clearTimeout(timer);
        const value = operatorNotes[inquiryId] ?? "";
        navigator.sendBeacon?.(
          "/api/event-inquiries/notes",
          new Blob([JSON.stringify({ inquiryId, notes: value })], {
            type: "application/json",
          })
        );
      }
    };
    // operatorNotes intentionally not in deps — we only want this
    // cleanup to fire on unmount, capturing whatever's pending then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tracks which inquiries this operator has already viewed in this
  // session — used to flip the unread dot off optimistically the
  // moment the IntersectionObserver fires, before the API round-trip
  // resolves. Server-side viewed_at is the durable store; this set is
  // a per-mount cache.
  const [locallyViewed, setLocallyViewed] = useState<Set<string>>(new Set());

  function myActionFor(inq: EventInquiry): EventInquiryAction | null {
    const slot = inq.operator_actions?.[currentUserId];
    return (slot?.action as EventInquiryAction) ?? null;
  }

  function isUnread(inq: EventInquiry): boolean {
    if (locallyViewed.has(inq.id)) return false;
    const slot = (inq.operator_actions ?? {})[currentUserId] as
      | { viewed_at?: string; action?: string }
      | undefined;
    // Read = ever-viewed OR ever-actioned. Action without viewed_at
    // (e.g. legacy rows) still counts as read because the operator
    // clearly saw it to act.
    return !slot?.viewed_at && !slot?.action;
  }

  // IntersectionObserver: once an inquiry's card crosses 25%
  // visibility, mark it as viewed. Batches IDs with a 300ms debounce
  // so a fast scroll doesn't fire 20 separate POSTs.
  const pendingViewsRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function queueMarkViewed(inquiryId: string) {
    pendingViewsRef.current.add(inquiryId);
    setLocallyViewed((prev) => {
      const next = new Set(prev);
      next.add(inquiryId);
      return next;
    });
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      const ids = Array.from(pendingViewsRef.current);
      pendingViewsRef.current.clear();
      flushTimerRef.current = null;
      if (ids.length === 0) return;
      fetch("/api/event-inquiries/mark-viewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryIds: ids }),
      })
        .then(() => {
          // Server-side viewed_at is now stamped — nudge the sidebar
          // badge in case any other UI reads viewed/unread counts.
          // Open-inquiry count is unaffected (it's keyed off action,
          // not viewed_at) but harmless to re-fetch.
          window.dispatchEvent(new Event("vendcast:sidebar-stale"));
        })
        .catch(() => {
          // Silent failure — locallyViewed already flipped UI optimistically.
          // On reload, server state will reconcile (or re-mark on next view).
        });
    }, 300);
  }
  // Flush pending views on unmount so a fast page-leave doesn't lose
  // the last batch.
  useEffect(() => {
    const pendingRef = pendingViewsRef;
    const timerRef = flushTimerRef;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        const ids = Array.from(pendingRef.current);
        if (ids.length > 0) {
          // Beacon-style fire-and-forget on teardown.
          navigator.sendBeacon?.(
            "/api/event-inquiries/mark-viewed",
            new Blob([JSON.stringify({ inquiryIds: ids })], {
              type: "application/json",
            })
          );
        }
      }
    };
  }, []);

  const filtered = inquiries.filter((inq) => {
    if (eventTypeFilter && inq.event_type !== eventTypeFilter) return false;
    const my = myActionFor(inq);
    if (filter === "open") return inq.status === "open" && my !== "declined";
    if (filter === "responded") return my === "claimed" || my === "contacted";
    return true;
  });

  async function handleAction(inquiryId: string, action: EventInquiryAction) {
    setBusy(inquiryId);
    try {
      const res = await fetch("/api/event-inquiries/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryId, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Action failed");
        setBusy(null);
        return;
      }
      const responseBody = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        eventId?: string;
      };
      // Optimistic local update — also refresh from server.
      setInquiries((prev) =>
        prev.map((inq) =>
          inq.id === inquiryId
            ? {
                ...inq,
                operator_actions: {
                  ...inq.operator_actions,
                  [currentUserId]: { action, at: new Date().toISOString() },
                },
              }
            : inq
        )
      );
      // If the server auto-created a planning event from this claim,
      // remember the event_id so the row immediately shows "View event"
      // instead of just a Claimed badge.
      if (action === "claimed" && responseBody.eventId) {
        setClaimedEventByInquiry((prev) => ({
          ...prev,
          [inquiryId]: responseBody.eventId!,
        }));
      }
      // Nudge the sidebar / mobile-nav badge counts. router.refresh()
      // re-runs Server Components but doesn't re-trigger client-side
      // useEffects, so the open-inquiry pill would otherwise show the
      // stale pre-action count until the next full reload.
      window.dispatchEvent(new Event("vendcast:sidebar-stale"));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  // IntersectionObserver: any inquiry card crossing 25% visibility
  // gets queued for mark-viewed. Observer is created once per filter
  // change so newly-rendered cards (after switching from Open → All)
  // are picked up.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
            const id = entry.target.getAttribute("data-inquiry-id");
            if (id) queueMarkViewed(id);
          }
        }
      },
      { threshold: 0.25 }
    );
    document.querySelectorAll("[data-inquiry-id]").forEach((el) => {
      obs.observe(el);
    });
    return () => obs.disconnect();
  }, [filter, inquiries]);

  if (inquiries.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center">
        <div className="w-12 h-12 rounded-full bg-brand-teal/10 flex items-center justify-center mx-auto mb-4">
          <Mail className="h-6 w-6 text-brand-teal" />
        </div>
        <p className="font-medium mb-1">No inquiries yet</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          When an event organizer in your city submits a request through{" "}
          <span className="font-medium">vendcast.co/request-event</span>, it&apos;ll show up here. Make sure your profile city is set so you appear in matches.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter row — status chips + event-type dropdown. Dropdown
          only renders when the operator has inquiries spanning more
          than one event type; otherwise it's noise. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 border rounded-md p-0.5 w-fit text-sm">
          {(["open", "responded", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                filter === f
                  ? "px-3 py-1 rounded bg-background shadow-sm text-foreground"
                  : "px-3 py-1 rounded text-muted-foreground hover:text-foreground"
              }
            >
              {f === "open" ? "Open" : f === "responded" ? "Responded" : "All"}
            </button>
          ))}
        </div>
        {availableEventTypes.length > 1 && (
          <select
            aria-label="Filter by event type"
            value={eventTypeFilter}
            onChange={(e) => handleEventTypeChange(e.target.value)}
            className="text-sm border rounded-md px-3 py-1.5 bg-background hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-brand-teal/40"
          >
            <option value="">All event types</option>
            {availableEventTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          No inquiries in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((inq) => {
            const my = myActionFor(inq);
            const timeRange = formatTimeRange(inq.event_start_time, inq.event_end_time);
            const claimedEventId = claimedEventByInquiry[inq.id];
            const unread = isUnread(inq);
            const conflictNames = conflictsByInquiry[inq.id] ?? [];
            const hasConflict = conflictNames.length > 0;
            const engagementCopy = engagementSignalByInquiry[inq.id];
            return (
              <div
                key={inq.id}
                data-inquiry-id={inq.id}
                className={`rounded-xl border bg-card p-5 md:p-6 space-y-4 ${
                  unread ? "border-brand-orange/40 bg-brand-orange/[0.02]" : ""
                }`}
              >
                {/* Header — date + status badges */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
                      {/* Unread dot — small orange marker. Subtle but
                          unmistakable next to the date/time meta line.
                          Disappears the moment the card crosses the
                          IntersectionObserver threshold. */}
                      {unread && (
                        <span
                          aria-label="Unread"
                          className="inline-block w-1.5 h-1.5 rounded-full bg-brand-orange"
                        />
                      )}
                      {relativeTime(inq.created_at)} · {inq.event_type}
                    </p>
                    <h3 className={`text-lg ${unread ? "font-bold" : "font-semibold"}`}>
                      {inq.event_name ?? `${inq.event_type} event`}
                    </h3>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {my === "claimed" && (
                      <Badge className="bg-brand-teal/15 text-brand-teal border-0">Interested</Badge>
                    )}
                    {my === "contacted" && (
                      <Badge className="bg-brand-orange/15 text-brand-orange border-0">Contacted</Badge>
                    )}
                    {my === "declined" && (
                      <Badge variant="outline" className="text-muted-foreground">Declined</Badge>
                    )}
                    {inq.status === "closed" && (
                      <Badge variant="outline">Closed</Badge>
                    )}
                    {inq.status === "expired" && (
                      <Badge variant="outline">Expired</Badge>
                    )}
                  </div>
                </div>

                {/* Engagement signal — soft qualitative copy that
                    other operators are pursuing this lead. No counts,
                    no names, suppressed below 2 engaged operators or
                    on past-date / expired inquiries. Privacy-
                    preserving by design (verdict in the brainstorm
                    spec). */}
                {engagementCopy && (
                  <p className="flex items-center gap-1.5 text-xs text-brand-teal/80 -mt-1">
                    <Radar className="h-3 w-3" />
                    <span className="italic">{engagementCopy}</span>
                  </p>
                )}

                {/* Calendar conflict warning — surfaces when the
                    operator already has another (non-cancelled, non-
                    self-created) event on this date. Warn-only; doesn't
                    disable any action button. Operator can still mark
                    Interested and double-book if they want — the
                    warning is information, not a guard. */}
                {hasConflict && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700/40 p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-900 dark:text-amber-100">
                        You already have an event scheduled on this date
                      </p>
                      <p className="text-xs text-amber-800 dark:text-amber-200/80 mt-0.5">
                        {conflictNames.length === 1
                          ? conflictNames[0]
                          : `${conflictNames.length} events: ${conflictNames.join(", ")}`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Detail grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">{formatDate(inq.event_date)}</p>
                      {timeRange && <p className="text-xs text-muted-foreground">{timeRange}</p>}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">{inq.city}, {inq.state}</p>
                      {inq.location_details && (
                        <p className="text-xs text-muted-foreground">{inq.location_details}</p>
                      )}
                    </div>
                  </div>
                  {inq.expected_attendance && (
                    <div className="flex items-start gap-2">
                      <Users className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <p>~{inq.expected_attendance.toLocaleString()} people expected</p>
                    </div>
                  )}
                  {inq.budget_estimate != null && inq.budget_estimate > 0 && (
                    <div className="flex items-start gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <p>Budget: ${inq.budget_estimate.toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {inq.notes && (
                  <div className="rounded-md bg-muted/40 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                      Organizer notes
                    </p>
                    <p className="whitespace-pre-wrap break-words">{inq.notes}</p>
                  </div>
                )}

                {/* Contact — primary action area for the operator;
                    teal-tinted to anchor it as the next step after
                    reading the inquiry details above. */}
                <div className="rounded-lg border border-brand-teal/20 bg-brand-teal/5 p-3.5 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-teal mb-2">
                    How to reach {inq.organizer_name}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {(() => {
                      // Build the templated mailto inline so the
                      // operator's email client opens with subject + a
                      // pre-written body referencing this inquiry's
                      // details. Operator can edit before sending.
                      const tpl = buildEmailTemplate({
                        organizerName: inq.organizer_name,
                        eventType: inq.event_type,
                        eventDate: inq.event_date,
                        city: inq.city,
                        state: inq.state,
                        operatorBusinessName,
                      });
                      const href =
                        `mailto:${inq.organizer_email}` +
                        `?subject=${encodeURIComponent(tpl.subject)}` +
                        `&body=${encodeURIComponent(tpl.body)}`;
                      return (
                        <a
                          href={href}
                          className="inline-flex items-center gap-1.5 hover:underline text-foreground"
                          title="Opens your email client with a pre-filled draft you can edit before sending"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {inq.organizer_email}
                        </a>
                      );
                    })()}
                    {inq.organizer_phone && (
                      <a
                        href={`tel:${inq.organizer_phone}`}
                        className="inline-flex items-center gap-1.5 hover:underline text-foreground"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {inq.organizer_phone}
                      </a>
                    )}
                    {inq.organizer_org && (
                      <span className="text-muted-foreground">· {inq.organizer_org}</span>
                    )}
                  </div>
                </div>

                {/* Actions — brand-aligned hierarchy:
                    "I'm interested" = brand-teal primary (entry point,
                       full brand presence)
                    "Mark contacted" = brand-teal outline (follow-up,
                       same hue family but subordinate weight)
                    "Not interested" = ghost (dismissal, neutral)
                    Per Verdict #25, both affirmative steps use teal —
                    orange is reserved for differentiator/closer
                    moments which doesn't apply to action chrome. */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => handleAction(inq.id, "claimed")}
                    disabled={busy === inq.id || my === "claimed"}
                    size="sm"
                    variant={my === "claimed" ? "outline" : "default"}
                    className={
                      my === "claimed"
                        ? "border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10"
                        : "bg-brand-teal hover:bg-brand-teal/90 text-white"
                    }
                  >
                    {busy === inq.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    {my === "claimed" ? "Interested" : "I'm interested"}
                  </Button>
                  <Button
                    onClick={() => handleAction(inq.id, "contacted")}
                    disabled={busy === inq.id || my === "contacted"}
                    size="sm"
                    variant="outline"
                    className="border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10"
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />
                    {my === "contacted" ? "Contacted" : "Mark contacted"}
                  </Button>
                  <Button
                    onClick={() => handleAction(inq.id, "declined")}
                    disabled={busy === inq.id || my === "declined"}
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    {my === "declined" ? "Declined" : "Not interested"}
                  </Button>
                  {/* Surfaces the planning event auto-created from the
                      claim. Only shown when this user has claimed the
                      inquiry AND the event_id is known (server-loaded
                      or from the action response). */}
                  {my === "claimed" && claimedEventId && (
                    <Link
                      href={`/dashboard/events?tab=unbooked&highlight=${claimedEventId}`}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal hover:text-brand-teal/80 ml-auto"
                    >
                      View event
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>

                {/* Operator-only private notes. Free-text follow-up
                    context — "called Sarah Mon, budget might rise" —
                    invisible to the organizer and to other matched
                    operators. Debounce-saved on type. */}
                <div className="border-t pt-3">
                  <label
                    htmlFor={`notes-${inq.id}`}
                    className="text-xs font-semibold uppercase tracking-widest text-muted-foreground block mb-1.5"
                  >
                    Your private notes
                  </label>
                  <textarea
                    id={`notes-${inq.id}`}
                    rows={2}
                    value={operatorNotes[inq.id] ?? ""}
                    onChange={(e) => handleNotesChange(inq.id, e.target.value)}
                    placeholder="Follow-up reminders, things you told the organizer, anything you want to remember about this lead. Only you see this."
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20 resize-none"
                  />
                </div>

                {/* Marketplace is non-mediated by design — clicking
                    Interested only books the lead in this operator's
                    own pipeline. The operator must email or call the
                    organizer themselves to actually win the booking.
                    Without this note, operators assume the button "did
                    the work" and leads go cold. */}
                <p className="text-xs text-muted-foreground">
                  Marking this doesn&apos;t notify the organizer. To win the booking, reach out directly via the contact info above — other operators in your area saw this request too.
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
