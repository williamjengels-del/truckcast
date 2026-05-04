import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import { updatePlatformRegistry } from "@/lib/platform-registry";

/**
 * Admin event-name alias management.
 *
 * GET    /api/admin/event-aliases       — list all aliases
 * POST   /api/admin/event-aliases       — create one
 * DELETE /api/admin/event-aliases?alias=<normalized>
 *
 * Why aliasing: platform_events buckets by lowercase+trim only, so
 * "Saturday Farmer's Market" and "Saturday Farmers Market" split
 * into two buckets. The autocomplete (#168) is the proactive nudge;
 * this is the corrective tool — admin can map a near-miss alias onto
 * its canonical bucket after the fact, and the registry recompute
 * folds the alias-form events into the canonical aggregate.
 */

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const service = getServiceClient();
  const { data, error } = await service
    .from("event_name_aliases")
    .select("alias_normalized, canonical_normalized, alias_display, canonical_display, created_by, notes, created_at")
    .order("canonical_normalized", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ aliases: data ?? [] });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const r = body as Record<string, unknown>;
  const aliasDisplay = typeof r.alias === "string" ? r.alias.trim() : "";
  const canonicalDisplay = typeof r.canonical === "string" ? r.canonical.trim() : "";
  const notes = typeof r.notes === "string" ? r.notes.trim() : null;

  if (!aliasDisplay || !canonicalDisplay) {
    return NextResponse.json(
      { error: "alias and canonical are both required" },
      { status: 400 }
    );
  }

  const aliasNorm = aliasDisplay.toLowerCase();
  const canonicalNorm = canonicalDisplay.toLowerCase();
  if (aliasNorm === canonicalNorm) {
    return NextResponse.json(
      { error: "Alias and canonical normalize to the same string." },
      { status: 400 }
    );
  }

  const service = getServiceClient();

  // Reject chains: the new alias must not point at an existing alias,
  // and the new canonical must not already BE an alias for something
  // else. Also reject if the alias is already someone else's canonical.
  const { data: chainCheck } = await service
    .from("event_name_aliases")
    .select("alias_normalized, canonical_normalized")
    .or(
      `alias_normalized.in.(${aliasNorm},${canonicalNorm}),canonical_normalized.in.(${aliasNorm},${canonicalNorm})`
    );

  for (const row of (chainCheck ?? []) as {
    alias_normalized: string;
    canonical_normalized: string;
  }[]) {
    if (row.alias_normalized === aliasNorm) {
      return NextResponse.json(
        { error: "An alias for that string already exists." },
        { status: 409 }
      );
    }
    if (row.canonical_normalized === aliasNorm) {
      return NextResponse.json(
        {
          error:
            "That string is already a canonical for another alias. Pick a different alias or remove the conflicting mapping first.",
        },
        { status: 409 }
      );
    }
    if (row.alias_normalized === canonicalNorm) {
      return NextResponse.json(
        {
          error:
            "The canonical you chose is itself an alias for another string. Pick the deeper canonical instead (no chains allowed).",
        },
        { status: 409 }
      );
    }
  }

  const { error: insertError } = await service
    .from("event_name_aliases")
    .insert({
      alias_normalized: aliasNorm,
      canonical_normalized: canonicalNorm,
      alias_display: aliasDisplay,
      canonical_display: canonicalDisplay,
      created_by: admin.id,
      notes,
    });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Recompute the canonical bucket so its aggregate folds in events
  // typed under the alias form. Best-effort; failure here doesn't roll
  // back the alias insert (the alias is still useful — events will
  // recompute on next save).
  try {
    await updatePlatformRegistry([canonicalDisplay]);
  } catch (e) {
    console.error("[event-aliases] recompute after insert failed:", e);
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "event_alias.create",
      targetType: "event_alias",
      targetId: aliasNorm,
      metadata: {
        alias_display: aliasDisplay,
        canonical_display: canonicalDisplay,
        notes,
      },
    },
    service
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const aliasNorm = (url.searchParams.get("alias") ?? "").trim().toLowerCase();
  if (!aliasNorm) {
    return NextResponse.json(
      { error: "alias query param required" },
      { status: 400 }
    );
  }

  const service = getServiceClient();

  // Read the row first so we can recompute the canonical bucket after
  // the delete (since the canonical's aggregate currently includes
  // events from the alias form, which it shouldn't post-removal).
  const { data: prior } = await service
    .from("event_name_aliases")
    .select("alias_normalized, canonical_normalized, alias_display, canonical_display")
    .eq("alias_normalized", aliasNorm)
    .maybeSingle();
  if (!prior) {
    return NextResponse.json({ error: "Alias not found" }, { status: 404 });
  }

  const { error: deleteError } = await service
    .from("event_name_aliases")
    .delete()
    .eq("alias_normalized", aliasNorm);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // Recompute the canonical AND the now-orphaned alias form. The
  // canonical drops the alias-form events; the alias form may now
  // qualify for its own platform_events row if events still exist
  // under it.
  try {
    const r = prior as {
      canonical_display: string;
      alias_display: string;
    };
    await updatePlatformRegistry([r.canonical_display, r.alias_display]);
  } catch (e) {
    console.error("[event-aliases] recompute after delete failed:", e);
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "event_alias.delete",
      targetType: "event_alias",
      targetId: aliasNorm,
      metadata: {
        alias_display: (prior as { alias_display: string }).alias_display,
        canonical_display: (prior as { canonical_display: string }).canonical_display,
      },
    },
    service
  );

  return NextResponse.json({ ok: true });
}
