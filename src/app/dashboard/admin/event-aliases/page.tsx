import type { Metadata } from "next";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { EventAliasesClient } from "./event-aliases-client";

export const metadata: Metadata = { title: "Event Aliases — Admin" };
export const dynamic = "force-dynamic";

interface AliasRow {
  alias_normalized: string;
  canonical_normalized: string;
  alias_display: string;
  canonical_display: string;
  notes: string | null;
  created_at: string;
}

export default async function EventAliasesPage() {
  // Auth handled by /dashboard/admin/layout.tsx (requireAdmin).
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await service
    .from("event_name_aliases")
    .select("alias_normalized, canonical_normalized, alias_display, canonical_display, notes, created_at")
    .order("canonical_normalized", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Event Aliases</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Map near-miss event-name spellings onto a canonical bucket so the cross-operator aggregate folds them together. Adding an alias triggers a recompute of the canonical bucket; removing one re-splits the data.
        </p>
      </div>
      <EventAliasesClient initialAliases={(data ?? []) as AliasRow[]} />
    </div>
  );
}
