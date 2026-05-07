import type { Metadata } from "next";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { redirect } from "next/navigation";
import { InquiriesInbox } from "./inquiries-inbox";
import type { EventInquiry } from "@/lib/database.types";
import { engagementSignalForInquiry } from "@/lib/inquiry-engagement";

export const metadata: Metadata = { title: "Event Inquiries — VendCast" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InquiriesPage() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") redirect("/login");

  // Triage order = soonest event first. Operator's job is "what do I
  // need to act on next?" not "what came in most recently." Tie-break
  // on created_at desc so two events on the same date show the
  // newer-arriving inquiry on top (rare in practice).
  const [inquiriesRes, profileRes] = await Promise.all([
    scope.client
      .from("event_inquiries")
      .select("*")
      .contains("matched_operator_ids", [scope.userId])
      .order("event_date", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(100),
    // Operator's business_name powers the email-template signature.
    // Fallback to "your VendCast operator" if the profile isn't set
    // yet so the template still renders coherently.
    scope.client
      .from("profiles")
      .select("business_name")
      .eq("id", scope.userId)
      .maybeSingle(),
  ]);

  const inquiries = (inquiriesRes.data ?? []) as EventInquiry[];
  const operatorBusinessName =
    (profileRes.data?.business_name as string | null) ?? "";
  // Per-operator notes preloaded server-side so the textarea hydrates
  // with what the operator last typed without a client round-trip.
  const initialOperatorNotes: Record<string, string> = {};
  for (const inq of inquiries) {
    const slot = (inq.operator_notes_by_user ?? {}) as Record<string, string>;
    if (slot[scope.userId]) initialOperatorNotes[inq.id] = slot[scope.userId];
  }

  // Engagement signal copy per inquiry. Computed server-side so the
  // tier logic stays in one place and the component just renders the
  // string. Suppression rules (past event_date, status=expired) are
  // applied here — see src/lib/inquiry-engagement.ts.
  const todayIso = new Date().toISOString().slice(0, 10);
  const engagementSignalByInquiry: Record<string, string> = {};
  for (const inq of inquiries) {
    const copy = engagementSignalForInquiry({
      operatorActions: inq.operator_actions ?? null,
      eventDate: inq.event_date,
      status: inq.status,
      todayIso,
    });
    if (copy) engagementSignalByInquiry[inq.id] = copy;
  }

  // Look up which inquiries already have a planning event so the inbox
  // can show "View event →" instead of just a Claimed badge. Empty list
  // is fine — `.in()` with [] returns no rows.
  const inquiryIds = inquiries.map((i) => i.id);
  const claimedEventByInquiry: Record<string, string> = {};
  // Calendar conflict map: inquiry_id → array of conflicting event names.
  // Conflict definition: same calendar date, operator-owned, BOOKED
  // (not unbooked planning rows — those are leads being pursued, not
  // schedule commitments), NOT the inquiry's own auto-created planning
  // event (excluded via source_inquiry_id != inquiry.id). Same-date is
  // enough for v1; time-of-day overlap is fancier but most catering
  // gigs span hours and a same-date warning catches what actually
  // matters.
  const conflictsByInquiry: Record<string, string[]> = {};
  if (inquiryIds.length > 0) {
    const inquiryDates = Array.from(new Set(inquiries.map((i) => i.event_date)));
    const [claimedEventsRes, conflictEventsRes] = await Promise.all([
      scope.client
        .from("events")
        .select("id, source_inquiry_id")
        .eq("user_id", scope.userId)
        .in("source_inquiry_id", inquiryIds),
      // Booked + non-cancelled only. Unbooked planning rows are leads
      // the operator is pursuing, not committed schedule items —
      // warning about them would discourage operators from marking
      // interest in multiple inquiries on the same date (which is
      // exactly what we want them to do until one converts).
      scope.client
        .from("events")
        .select("id, event_name, event_date, source_inquiry_id, cancellation_reason")
        .eq("user_id", scope.userId)
        .eq("booked", true)
        .in("event_date", inquiryDates)
        .is("cancellation_reason", null),
    ]);
    for (const ev of (claimedEventsRes.data ?? []) as { id: string; source_inquiry_id: string | null }[]) {
      if (ev.source_inquiry_id) claimedEventByInquiry[ev.source_inquiry_id] = ev.id;
    }
    const conflictRows = (conflictEventsRes.data ?? []) as {
      id: string;
      event_name: string;
      event_date: string;
      source_inquiry_id: string | null;
    }[];
    for (const inq of inquiries) {
      const matchingEvents = conflictRows.filter(
        (ev) => ev.event_date === inq.event_date && ev.source_inquiry_id !== inq.id
      );
      if (matchingEvents.length > 0) {
        conflictsByInquiry[inq.id] = matchingEvents.map((ev) => ev.event_name);
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event inquiries</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Open requests from event organizers in your area. Reach out directly via the organizer&apos;s email — VendCast doesn&apos;t mediate.
        </p>
      </div>

      <InquiriesInbox
        initialInquiries={inquiries}
        currentUserId={scope.userId}
        initialClaimedEventByInquiry={claimedEventByInquiry}
        conflictsByInquiry={conflictsByInquiry}
        initialOperatorNotes={initialOperatorNotes}
        operatorBusinessName={operatorBusinessName}
        engagementSignalByInquiry={engagementSignalByInquiry}
      />
    </div>
  );
}
