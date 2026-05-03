"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
} from "lucide-react";
import type { EventInquiry, EventInquiryAction } from "@/lib/database.types";

interface Props {
  initialInquiries: EventInquiry[];
  currentUserId: string;
  // Map of inquiry_id → event_id for inquiries this user has already
  // claimed. Populated by the server-side page; the component layers
  // freshly-claimed event IDs from the action-route response on top.
  initialClaimedEventByInquiry?: Record<string, string>;
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

export function InquiriesInbox({
  initialInquiries,
  currentUserId,
  initialClaimedEventByInquiry = {},
}: Props) {
  const router = useRouter();
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "responded">("open");
  const [claimedEventByInquiry, setClaimedEventByInquiry] = useState(
    initialClaimedEventByInquiry
  );

  function myActionFor(inq: EventInquiry): EventInquiryAction | null {
    const slot = inq.operator_actions?.[currentUserId];
    return (slot?.action as EventInquiryAction) ?? null;
  }

  const filtered = inquiries.filter((inq) => {
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
      {/* Filter chips */}
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
            return (
              <div
                key={inq.id}
                className="rounded-xl border bg-card p-5 md:p-6 space-y-4"
              >
                {/* Header — date + status badges */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                      {relativeTime(inq.created_at)} · {inq.event_type}
                    </p>
                    <h3 className="text-lg font-semibold">
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

                {/* Contact */}
                <div className="rounded-md border bg-brand-teal/5 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-brand-teal mb-2">
                    How to reach {inq.organizer_name}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <a
                      href={`mailto:${inq.organizer_email}?subject=Re: your VendCast event request`}
                      className="inline-flex items-center gap-1.5 hover:underline text-foreground"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {inq.organizer_email}
                    </a>
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

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => handleAction(inq.id, "claimed")}
                    disabled={busy === inq.id || my === "claimed"}
                    size="sm"
                    variant={my === "claimed" ? "outline" : "default"}
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

                {/* Marketplace is non-mediated by design — clicking
                    Interested only books the lead in this operator's
                    own pipeline. The operator must email or call the
                    organizer themselves to actually win the booking.
                    Without this note, operators assume the button "did
                    the work" and leads go cold. */}
                <p className="text-xs text-muted-foreground border-t pt-3">
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
