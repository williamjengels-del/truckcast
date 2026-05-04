import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import {
  findSuggestionPairs,
  pairKey,
  type EventNameInput,
} from "@/lib/event-name-similarity";

/**
 * GET /api/admin/event-aliases/suggestions
 *
 * Returns up to N near-miss platform_events bucket pairs that an admin
 * might want to alias. Filters out pairs that are already aliased OR
 * that admin has explicitly dismissed.
 *
 * Pure read. Computes pairwise similarity in app code (no pg_trgm
 * dependency). At current platform_events scale (~200 buckets) this is
 * a few-millisecond comparison; at the few-thousand range it's still
 * sub-100ms. If we exceed that, switch to pg_trgm with a similarity
 * index.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const minRatio = Number(url.searchParams.get("minRatio") ?? "0.7");
  const limit = Number(url.searchParams.get("limit") ?? "30");

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Source set: every platform_events bucket, with operator_count so
  // the UI can show "this side has 4 ops, that side has 2" — admin
  // wants the higher-count one to win as canonical.
  const { data: rows, error: pErr } = await service
    .from("platform_events")
    .select("event_name_normalized, event_name_display, operator_count");
  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const inputs: EventNameInput[] = (rows ?? []).map(
    (r: {
      event_name_normalized: string;
      event_name_display: string;
      operator_count: number;
    }) => ({
      normalized: r.event_name_normalized,
      display: r.event_name_display,
      operator_count: r.operator_count,
    })
  );

  // Build the exclude-pair set: existing aliases (any direction) +
  // admin-dismissed pairs.
  const [{ data: aliasRows }, { data: dismissedRows }] = await Promise.all([
    service
      .from("event_name_aliases")
      .select("alias_normalized, canonical_normalized"),
    service
      .from("event_alias_dismissed_pairs")
      .select("pair_key"),
  ]);

  const exclude = new Set<string>();
  for (const r of (aliasRows ?? []) as {
    alias_normalized: string;
    canonical_normalized: string;
  }[]) {
    exclude.add(pairKey(r.alias_normalized, r.canonical_normalized));
  }
  for (const r of (dismissedRows ?? []) as { pair_key: string }[]) {
    exclude.add(r.pair_key);
  }

  const pairs = findSuggestionPairs(inputs, exclude, {
    minRatio,
    limit,
  });

  return NextResponse.json({ suggestions: pairs });
}
