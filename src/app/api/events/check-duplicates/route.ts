import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface CheckRow {
  event_name: string;
  event_date: string;
}

interface DuplicateMatch {
  event_name: string;
  event_date: string;
  existing_event_id: string;
  existing_net_sales: number | null;
}

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
    const rows: CheckRow[] = body.rows ?? [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    // Collect unique event names and dates to query
    const eventNames = [...new Set(rows.map((r) => r.event_name).filter(Boolean))];
    const eventDates = [...new Set(rows.map((r) => r.event_date).filter(Boolean))];

    if (eventNames.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    // Fetch existing events matching any of these names+dates
    const { data: existingEvents, error } = await supabase
      .from("events")
      .select("id, event_name, event_date, net_sales")
      .eq("user_id", user.id)
      .in("event_name", eventNames)
      .in("event_date", eventDates);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Build a lookup map: "event_name|event_date" -> existing event
    const existingMap = new Map<string, { id: string; net_sales: number | null }>();
    for (const ev of existingEvents ?? []) {
      const key = `${ev.event_name}|${ev.event_date}`;
      existingMap.set(key, { id: ev.id, net_sales: ev.net_sales });
    }

    // Find duplicates among the incoming rows
    const duplicates: DuplicateMatch[] = [];
    for (const row of rows) {
      if (!row.event_name || !row.event_date) continue;
      const key = `${row.event_name}|${row.event_date}`;
      const existing = existingMap.get(key);
      if (existing) {
        duplicates.push({
          event_name: row.event_name,
          event_date: row.event_date,
          existing_event_id: existing.id,
          existing_net_sales: existing.net_sales,
        });
      }
    }

    return NextResponse.json({ duplicates });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
