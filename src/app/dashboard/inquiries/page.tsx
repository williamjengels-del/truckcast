import type { Metadata } from "next";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { redirect } from "next/navigation";
import { InquiriesInbox } from "./inquiries-inbox";
import type { EventInquiry } from "@/lib/database.types";

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
  const { data } = await scope.client
    .from("event_inquiries")
    .select("*")
    .contains("matched_operator_ids", [scope.userId])
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(100);

  const inquiries = (data ?? []) as EventInquiry[];

  // Look up which inquiries already have a planning event so the inbox
  // can show "View event →" instead of just a Claimed badge. Empty list
  // is fine — `.in()` with [] returns no rows.
  const inquiryIds = inquiries.map((i) => i.id);
  const claimedEventByInquiry: Record<string, string> = {};
  if (inquiryIds.length > 0) {
    const { data: events } = await scope.client
      .from("events")
      .select("id, source_inquiry_id")
      .eq("user_id", scope.userId)
      .in("source_inquiry_id", inquiryIds);
    for (const ev of (events ?? []) as { id: string; source_inquiry_id: string | null }[]) {
      if (ev.source_inquiry_id) claimedEventByInquiry[ev.source_inquiry_id] = ev.id;
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
      />
    </div>
  );
}
