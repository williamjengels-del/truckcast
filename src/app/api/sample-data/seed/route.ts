import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/sample-data/seed
 *
 * Seeds ~30 realistic sample events for the calling operator. Marks
 * each row with is_sample=true so they can be cleanly removed via
 * /api/sample-data/clear.
 *
 * Idempotent: if the operator already has sample rows, refuses to
 * seed again (pointing them at /api/sample-data/clear first). Prevents
 * duplicate-seed bloat from repeated button clicks.
 *
 * Why server-side fixture (vs JSON file): event_date needs to be
 * dynamic (recent past + near future relative to "now") so the
 * forecasts + day-of card render meaningful state. Generating in TS
 * is the cleanest way to keep that current.
 */

// Realistic event archetypes — names, types, typical attendance, weather
// patterns, fee structures. Numbers chosen to look like a credible
// mid-volume mobile vendor's history (similar to a real Wok-O slice).
const ARCHETYPES = [
  { name: "Lunchtime Live", type: "Weekly Series", attend: 600, sales: 1100, weather: "Clear", dow: 5, fee_type: "flat_fee", fee_rate: 50 },
  { name: "Saturday Farmers Market", type: "Community/Neighborhood", attend: 1200, sales: 1450, weather: "Clear", dow: 6, fee_type: "flat_fee", fee_rate: 75 },
  { name: "Festival of Nations", type: "Festival", attend: 8000, sales: 2400, weather: "Hot", dow: 6, fee_type: "percentage", fee_rate: 15 },
  { name: "Concert in the Park", type: "Concert", attend: 1800, sales: 1650, weather: "Clear", dow: 5, fee_type: "percentage", fee_rate: 12 },
  { name: "Corporate Lunch — Cardinal Glennon", type: "Corporate", attend: 250, sales: 850, weather: "Clear", dow: 3, fee_type: "none", fee_rate: 0 },
  { name: "Soulard Mardi Gras", type: "Festival", attend: 6000, sales: 2100, weather: "Cold", dow: 6, fee_type: "flat_fee", fee_rate: 200 },
  { name: "Forest Park Picnic", type: "Community/Neighborhood", attend: 800, sales: 950, weather: "Clear", dow: 0, fee_type: "none", fee_rate: 0 },
  { name: "Brewery Pop-Up", type: "Community/Neighborhood", attend: 400, sales: 720, weather: "Clear", dow: 4, fee_type: "flat_fee", fee_rate: 40 },
  { name: "Tower Grove Farmers Market", type: "Community/Neighborhood", attend: 1500, sales: 1380, weather: "Clear", dow: 6, fee_type: "flat_fee", fee_rate: 60 },
  { name: "Rainy Saturday Market", type: "Community/Neighborhood", attend: 400, sales: 380, weather: "Rain During Event", dow: 6, fee_type: "flat_fee", fee_rate: 60 },
  { name: "Sports Tailgate — Busch", type: "Sports Event", attend: 3000, sales: 1850, weather: "Clear", dow: 6, fee_type: "percentage", fee_rate: 18 },
  { name: "Office Park Friday", type: "Corporate", attend: 180, sales: 620, weather: "Clear", dow: 5, fee_type: "none", fee_rate: 0 },
  { name: "Charity Run", type: "Fundraiser/Charity", attend: 900, sales: 720, weather: "Cold", dow: 6, fee_type: "none", fee_rate: 0 },
  { name: "Ellisville Concert", type: "Concert", attend: 1200, sales: 1180, weather: "Overcast", dow: 5, fee_type: "percentage", fee_rate: 10 },
];

interface SeedRow {
  user_id: string;
  event_name: string;
  event_date: string;
  event_type: string;
  event_mode: string;
  location: string;
  city: string;
  state: string;
  expected_attendance: number;
  other_trucks: number;
  fee_type: string;
  fee_rate: number;
  sales_minimum: number;
  net_sales: number | null;
  forecast_sales: number | null;
  forecast_low: number | null;
  forecast_high: number | null;
  forecast_confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  event_weather: string;
  booked: boolean;
  anomaly_flag: string;
  start_time: string;
  end_time: string;
  is_sample: true;
}

function generateRows(userId: string): SeedRow[] {
  const rows: SeedRow[] = [];
  const today = new Date();
  // 90 days back through 30 days forward — past dominates so forecasts
  // render with calibration; future events show day-of card potential.
  for (let i = -90; i <= 30; i += 4) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const archetype = ARCHETYPES[Math.abs(i) % ARCHETYPES.length];
    // Skew DOW toward weekends for realism — cycle through archetypes
    // and let their canonical DOW dictate. If today's iteration date
    // doesn't match the archetype's DOW, nudge the date by ±3 days.
    const targetDow = archetype.dow;
    const actualDow = d.getDay();
    const diff = targetDow - actualDow;
    if (diff !== 0 && Math.abs(diff) <= 3) {
      d.setDate(d.getDate() + diff);
    }
    // Add small variance so sales aren't suspiciously identical
    const variance = 0.85 + ((i * 17) % 30) / 100;
    const sales = Math.round(archetype.sales * variance);
    const isPast = d < today;
    const startHour = archetype.dow === 6 || archetype.dow === 0 ? 11 : 17;
    const endHour = startHour + 5;

    rows.push({
      user_id: userId,
      event_name: archetype.name,
      event_date: d.toISOString().slice(0, 10),
      event_type: archetype.type,
      event_mode: "food_truck",
      location: archetype.name + " Venue",
      city: "St. Louis",
      state: "MO",
      expected_attendance: archetype.attend,
      other_trucks: 4 + ((i * 7) % 6),
      fee_type: archetype.fee_type,
      fee_rate: archetype.fee_rate,
      sales_minimum: 0,
      net_sales: isPast ? sales : null,
      forecast_sales: Math.round(archetype.sales * 1.02),
      forecast_low: Math.round(archetype.sales * 0.85),
      forecast_high: Math.round(archetype.sales * 1.15),
      forecast_confidence: i < -30 ? "HIGH" : i < 0 ? "MEDIUM" : "LOW",
      event_weather: archetype.weather,
      booked: true,
      anomaly_flag: "normal",
      start_time: `${String(startHour).padStart(2, "0")}:00:00`,
      end_time: `${String(endHour).padStart(2, "0")}:00:00`,
      is_sample: true,
    });
  }
  return rows;
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Idempotency: refuse to seed if sample rows already present.
  const { count: existing } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_sample", true);

  if ((existing ?? 0) > 0) {
    return NextResponse.json(
      {
        error: "Sample data already loaded. Clear it first with /api/sample-data/clear.",
        existing_count: existing,
      },
      { status: 409 }
    );
  }

  const rows = generateRows(user.id);
  const { error } = await supabase.from("events").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length });
}
