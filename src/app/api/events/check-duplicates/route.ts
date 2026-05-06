import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  detectDuplicates,
  type DuplicateMatch,
  type ExistingEvent,
  type IncomingRow,
} from "@/lib/event-duplicate-detection";

export type { DuplicateMatch };

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const rows: IncomingRow[] = body.rows ?? [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    const eventDates = [
      ...new Set(rows.map((r) => r.event_date).filter(Boolean)),
    ];

    if (eventDates.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    // Pull every existing event on any of the incoming dates. We no
    // longer narrow by event_name — the fuzzy matcher needs to see
    // all same-date events to catch apostrophe drift and the
    // comma-prefixed location case ("Tower Grove Park, Food Truck
    // Friday" vs "Food Truck Friday"). The volume is bounded by
    // (operator's events on those specific dates), which is small.
    const { data: existingEvents, error } = await supabase
      .from("events")
      .select("id, event_name, event_date, net_sales")
      .eq("user_id", user.id)
      .in("event_date", eventDates);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const existing: ExistingEvent[] = (existingEvents ?? []).map((ev) => ({
      id: ev.id,
      event_name: ev.event_name,
      event_date: ev.event_date,
      net_sales: ev.net_sales,
    }));

    const duplicates = detectDuplicates(rows, existing);
    return NextResponse.json({ duplicates });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
