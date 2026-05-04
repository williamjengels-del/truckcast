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

// Sample inquiries — match the operator's city ("St. Louis") so the
// canonicalized routing query lands them in the inbox. Mix of event
// types and statuses so the inbox visually demonstrates triage
// (open / interested / contacted). The third + fourth inquiries
// share the "summer festival" archetype so the engagement signal
// can fire on the third (≥3 engaged operators in the same lead set
// triggers the "Picking up steam" copy).
interface SampleInquiry {
  organizer_name: string;
  organizer_email: string;
  organizer_phone: string;
  event_name: string;
  daysFromNow: number;
  event_type: string;
  expected_attendance: number;
  location_details: string;
  notes: string;
  // Action this operator (the demo account) has taken on the inquiry,
  // if any. Lets a screenshot show a mix of unread / interested /
  // contacted cards. null = open + unactioned.
  myAction: "claimed" | "contacted" | null;
  // Number of OTHER (synthetic) operators who marked Interested or
  // Contacted on this inquiry. Drives the engagement signal copy
  // (≥2 → "On a few operators' radars", ≥3 → "Picking up steam",
  // ≥5 → "Drawing real interest").
  peerEngaged: number;
}

const SAMPLE_INQUIRIES: SampleInquiry[] = [
  {
    organizer_name: "Maya Henderson",
    organizer_email: "events@samplecorp.demo",
    organizer_phone: "(314) 555-0142",
    event_name: "Quarterly all-hands lunch",
    daysFromNow: 9,
    event_type: "Corporate",
    expected_attendance: 220,
    location_details: "Centene Plaza, downtown",
    notes: "Need 1 truck, 11:30–1:30. Vegetarian options required for ~30% of crowd.",
    myAction: null,
    peerEngaged: 1,
  },
  {
    organizer_name: "Daniel Park",
    organizer_email: "daniel@samplehoa.demo",
    organizer_phone: "(314) 555-0188",
    event_name: "Lafayette Square Block Party",
    daysFromNow: 21,
    event_type: "Community/Neighborhood",
    expected_attendance: 600,
    location_details: "Park Ave between Mississippi and 18th",
    notes: "Looking for 2–3 trucks. Beer garden across the street so dessert/savory mix preferred.",
    myAction: "contacted",
    peerEngaged: 2,
  },
  {
    organizer_name: "Priya Subramanian",
    organizer_email: "priya@samplefest.demo",
    organizer_phone: "(636) 555-0199",
    event_name: "Riverfront Summer Festival",
    daysFromNow: 38,
    event_type: "Festival",
    expected_attendance: 4500,
    location_details: "Kiener Plaza main stage area",
    // Engagement signal target — 4 peers + this operator's action.
    notes: "Three-day festival. Looking for vendors with demonstrated festival experience and a generator-included setup.",
    myAction: null,
    peerEngaged: 4,
  },
  {
    organizer_name: "Jordan Walsh",
    organizer_email: "jordan@samplewedding.demo",
    organizer_phone: "(314) 555-0167",
    event_name: "Walsh + Patel wedding",
    daysFromNow: 54,
    event_type: "Private Party",
    expected_attendance: 130,
    location_details: "Backyard reception, U-City",
    notes: "Late-night bites, 9pm–11pm. Tacos preferred — can scale to ~200 if guest count creeps.",
    myAction: "claimed",
    peerEngaged: 0,
  },
];

// Generate `peerEngaged` synthetic operator UUIDs for the
// operator_actions slot. Stable per-inquiry so the same UUIDs roll
// forward across renders (no flicker if anything pre-hydrates from
// the DB). Uses a deterministic prefix tied to the inquiry archetype.
function syntheticPeerActions(inquiry: SampleInquiry): Record<string, { action: "claimed" | "contacted"; at: string }> {
  const slot: Record<string, { action: "claimed" | "contacted"; at: string }> = {};
  for (let i = 0; i < inquiry.peerEngaged; i++) {
    // Synthetic uuid namespace — matches the v4 shape so any UUID
    // validator on read paths doesn't trip. Last segment varies by
    // (inquiry archetype, peer index).
    const uuid = `00000000-0000-4000-8000-${String(i).padStart(8, "0")}${inquiry.event_name.replace(/[^a-z0-9]/gi, "").slice(0, 4).padEnd(4, "0")}`;
    slot[uuid] = {
      action: i % 2 === 0 ? "claimed" : "contacted",
      at: new Date(Date.now() - (i + 1) * 4 * 60 * 60 * 1000).toISOString(),
    };
  }
  return slot;
}

interface SampleContact {
  user_id: string;
  name: string;
  email: string;
  phone: string;
  organization: string;
  notes: string;
  is_sample: true;
}

// One demo contact wired to the most recent past event ("Today's
// Event" surfaces will show this contact in the day-of card if the
// operator's event_date matches today). Kept minimal — most demo
// value is in the inquiries + events; contacts are a supporting
// surface for the day-of-event card screenshot.
const SAMPLE_CONTACTS: Omit<SampleContact, "user_id">[] = [
  {
    name: "Casey Rivera",
    email: "casey@samplevenue.demo",
    phone: "(314) 555-0124",
    organization: "Sample Venue Group",
    notes: "Day-of contact — keys to the loading bay are at the front desk.",
    is_sample: true,
  },
];

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Idempotency: refuse to seed if sample rows already present.
  // Checks events first (still the bulk of the seed); inquiries +
  // contacts share the same gate so partial runs don't create
  // mixed state.
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
  const { error: eventsError } = await supabase.from("events").insert(rows);
  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  // Inquiries — populate matched_operator_ids with the demo user's id
  // so the inbox query (`contains("matched_operator_ids", [userId])`)
  // sees them. operator_actions includes synthetic peers so the
  // engagement signal copy renders.
  const today = new Date();
  const inquiryRows = SAMPLE_INQUIRIES.map((inq) => {
    const eventDate = new Date(today);
    eventDate.setDate(eventDate.getDate() + inq.daysFromNow);
    const peerSlot = syntheticPeerActions(inq);
    const ownSlot = inq.myAction
      ? { [user.id]: { action: inq.myAction, at: new Date().toISOString() } }
      : {};
    return {
      organizer_name: inq.organizer_name,
      organizer_email: inq.organizer_email,
      organizer_phone: inq.organizer_phone,
      organizer_org: null,
      event_name: inq.event_name,
      event_date: eventDate.toISOString().slice(0, 10),
      event_type: inq.event_type,
      expected_attendance: inq.expected_attendance,
      city: "St. Louis",
      state: "MO",
      location_details: inq.location_details,
      budget_estimate: null,
      notes: inq.notes,
      status: "open" as const,
      matched_operator_ids: [user.id],
      operator_actions: { ...peerSlot, ...ownSlot },
      is_sample: true,
    };
  });
  const { error: inquiriesError } = await supabase
    .from("event_inquiries")
    .insert(inquiryRows);
  if (inquiriesError) {
    // Don't fail the whole seed — events already inserted are still
    // useful. Log and continue.
    console.error("[sample-data/seed] inquiries insert failed:", inquiriesError.message);
  }

  // Contacts — single demo contact for the day-of card screenshot.
  const contactRows = SAMPLE_CONTACTS.map((c) => ({ ...c, user_id: user.id }));
  const { error: contactsError } = await supabase
    .from("contacts")
    .insert(contactRows);
  if (contactsError) {
    console.error("[sample-data/seed] contacts insert failed:", contactsError.message);
  }

  return NextResponse.json({
    ok: true,
    inserted: rows.length,
    inquiries: inquiriesError ? 0 : inquiryRows.length,
    contacts: contactsError ? 0 : contactRows.length,
  });
}
