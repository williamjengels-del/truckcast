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

  const { data } = await scope.client
    .from("event_inquiries")
    .select("*")
    .contains("matched_operator_ids", [scope.userId])
    .order("created_at", { ascending: false })
    .limit(100);

  const inquiries = (data ?? []) as EventInquiry[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event inquiries</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Open requests from event organizers in your area. Reach out directly via the organizer&apos;s email — VendCast doesn&apos;t mediate.
        </p>
      </div>

      <InquiriesInbox initialInquiries={inquiries} currentUserId={scope.userId} />
    </div>
  );
}
