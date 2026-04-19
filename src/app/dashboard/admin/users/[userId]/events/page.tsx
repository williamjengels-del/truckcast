import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ChevronLeft } from "lucide-react";
import { EventsPageClient } from "./events-page-client";
import type { Event } from "@/lib/database.types";

// Auth handled by /dashboard/admin/layout.tsx.
//
// Per-user events page — scoped to a single profile, shows ALL of their
// events (no date restriction, no row cap). Replaces the prior
// "View all events → /admin/data filtered by business" flow: that route
// worked for casual browsing but the cross-tenant structure made
// per-user operator work (searching, filtering by year, editing, flag
// triage) awkward. This page is scoped to one user from the jump and
// reuses the same EventForm + admin edit/anomaly API routes as the
// recent-events card on the user detail page.
//
// Primary use case: Nick Baur franchise reactivation. He has ~100
// historical events to walk through; Julian needs a fast surface for
// year filtering, search, and one-click edit/flag per row.

interface PageProps {
  params: Promise<{ userId: string }>;
}

export default async function UserEventsPage({ params }: PageProps) {
  const { userId } = await params;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [profileResult, eventsResult] = await Promise.all([
    service.from("profiles").select("*").eq("id", userId).maybeSingle(),
    // Full event list for this user. select("*") because EventForm
    // (reused in the admin edit modal) needs the full Event shape as
    // initialData. Order desc by date so the initial server render is
    // already close to the client's default sort (past tab equivalent
    // — newest first); the client then sorts in-memory per user input.
    service
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .order("event_date", { ascending: false }),
  ]);

  const profile = profileResult.data;
  if (!profile) notFound();

  const events = (eventsResult.data ?? []) as Event[];

  // Resolve email via auth admin for the header subtitle. Kept separate
  // from the Promise.all above because it's orthogonal (auth.admin API
  // doesn't share the same error surface as table queries).
  const authResult = await service.auth.admin.getUserById(userId);
  const email = authResult.data?.user?.email ?? null;

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/admin/users/${userId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {profile.business_name ?? email ?? "user"}
      </Link>

      <div>
        <h1 className="text-2xl font-bold">
          Events — {profile.business_name ?? email ?? "(no business name)"}
        </h1>
        <p className="text-sm text-muted-foreground">
          All {events.length} event{events.length === 1 ? "" : "s"}. Use the
          filters to narrow, click a column header to sort, and use the row
          actions to edit or flag anomalies.
        </p>
      </div>

      <EventsPageClient
        initialEvents={events}
        businessName={profile.business_name ?? email ?? ""}
        profileState={profile.state ?? undefined}
      />
    </div>
  );
}
