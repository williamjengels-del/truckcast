// Shared CSV import parser for VendCast events.
//
// Why a shared module:
//   Originally this logic lived inline inside the self-serve CSV
//   import tab (src/app/dashboard/integrations/csv-import-tab.tsx).
//   Admin-assisted imports on /dashboard/admin/users/[userId] need the
//   same format, the same aliases, the same edge-case handling, and
//   — critically — the same server-side validation as the client-side
//   preview. Forking the parser would drift over time as new event
//   types or column aliases get added. This module is the single
//   source of truth.
//
// Design constraints:
//   * Pure functions only. No React, no hooks, no DB access.
//     Runs identically in client or server environments (which is
//     essential for the admin path: preview client-side, re-parse
//     server-side on confirm).
//   * No dependencies outside the stdlib. Keep bundle footprint small.
//   * Behavior is locked to the prior inline implementation.
//     Commit 4a (this file) is mechanical extraction only.

import Papa from "papaparse";
import { canonicalizeCity } from "@/lib/city-normalize";
import {
  US_STATES,
  US_STATE_NAMES,
  OTHER_STATE,
} from "@/lib/constants";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export type FieldKey =
  | "event_name"
  | "event_date"
  | "start_time"
  | "end_time"
  | "time_range"
  | "setup_time"
  | "city"
  | "state"
  | "location"
  | "net_sales"
  | "event_type"
  | "fee_type"
  | "fee_rate"
  | "forecast_sales"
  | "notes"
  | "booked"
  | "event_tier"
  | "anomaly_flag"
  | "weather_type"
  | "expected_attendance"
  | "sales_minimum"
  | "event_mode"
  | "food_cost"
  | "labor_cost"
  | "other_costs";

export interface ParsedRow {
  event_name: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  setup_time?: string;
  city?: string;
  state?: string;
  net_sales?: number;
  event_type?: string;
  location?: string;
  fee_type?: string;
  fee_rate?: number;
  forecast_sales?: number;
  notes?: string;
  booked?: boolean;
  event_tier?: string;
  anomaly_flag?: string;
  weather_type?: string;
  expected_attendance?: number;
  sales_minimum?: number;
  event_mode?: string;
  food_cost?: number;
  labor_cost?: number;
  other_costs?: number;
  valid: boolean;
  error?: string;
  multi_day_label?: string;
}

/** A single CSV column: its original header, index, sample values, and user-assigned field. */
export interface ColumnMapping {
  index: number;
  originalHeader: string;
  sampleValues: string[];
  autoDetected: FieldKey | null;
  assignedField: FieldKey | "skip";
}

// ═══════════════════════════════════════════════════════════════════════
// Field metadata for the mapping UI
// ═══════════════════════════════════════════════════════════════════════

export const FIELD_OPTIONS: { value: FieldKey | "skip"; label: string; description: string }[] = [
  { value: "skip", label: "Skip this column", description: "Don't import" },
  { value: "event_name", label: "Event Name", description: "Required — name of the event" },
  { value: "event_date", label: "Date", description: "Event date (various formats)" },
  { value: "start_time", label: "Start Time", description: "Can include date + time" },
  { value: "end_time", label: "End Time", description: "Can include date + time" },
  { value: "time_range", label: "Time Range (Start–End)", description: "Single column with both start and end (e.g. \"5:00 PM - 9:00 PM\")" },
  { value: "setup_time", label: "Setup Time", description: "Can include date + time" },
  { value: "city", label: "City", description: "City name" },
  { value: "state", label: "State", description: "US 2-letter state code (MO, IL, CA, …)" },
  { value: "location", label: "Location / Venue", description: "Venue or address" },
  { value: "net_sales", label: "Net Sales", description: "Revenue / sales amount" },
  { value: "event_type", label: "Event Type", description: "Festival, Corporate, etc." },
  { value: "fee_type", label: "Fee Type", description: "None, Flat Fee, Percentage, etc." },
  { value: "fee_rate", label: "Fee Rate", description: "Fee amount or percentage" },
  { value: "sales_minimum", label: "Sales Minimum", description: "Minimum sales guarantee" },
  { value: "forecast_sales", label: "Forecast Sales", description: "Predicted / forecasted revenue" },
  { value: "booked", label: "Booked", description: "Yes/No — is this event confirmed?" },
  { value: "event_tier", label: "Event Tier", description: "A, B, C, or D" },
  { value: "anomaly_flag", label: "Anomaly Flag", description: "normal, disrupted, or boosted" },
  { value: "weather_type", label: "Weather", description: "Weather conditions at the event" },
  { value: "expected_attendance", label: "Expected Attendance", description: "Estimated crowd size" },
  { value: "notes", label: "Notes", description: "Additional notes or comments" },
  { value: "event_mode", label: "Event Mode", description: "food_truck or catering" },
  { value: "food_cost", label: "Food Cost", description: "Cost of food/ingredients" },
  { value: "labor_cost", label: "Labor Cost", description: "Labor / staffing cost" },
  { value: "other_costs", label: "Other Costs", description: "Supplies, fuel, misc costs" },
];

// Basic fields shown by default; advanced fields hidden until toggle is expanded
export const BASIC_FIELD_VALUES: (FieldKey | "skip")[] = [
  "skip",
  "event_name",
  "event_date",
  "start_time",
  "end_time",
  "time_range",
  "city",
  "state",
  "location",
  "net_sales",
  "event_type",
  "booked",
];

export const ADVANCED_FIELD_VALUES: (FieldKey | "skip")[] = [
  "setup_time",
  "fee_type",
  "fee_rate",
  "sales_minimum",
  "forecast_sales",
  "event_tier",
  "anomaly_flag",
  "weather_type",
  "expected_attendance",
  "notes",
  "event_mode",
  "food_cost",
  "labor_cost",
  "other_costs",
];

// ═══════════════════════════════════════════════════════════════════════
// Column auto-detection aliases
// ═══════════════════════════════════════════════════════════════════════

export const COLUMN_ALIASES: Record<FieldKey, string[]> = {
  event_name: [
    "event_name", "eventname", "event name", "event", "name", "title", "event title",
    "gig", "gig name", "booking", "booking name",
  ],
  event_date: [
    "event_date", "eventdate", "event date", "date", "day",
    // SkyTab exports
    "business date", "date closed", "check date", "closed date", "open date",
  ],
  start_time: [
    "start_time", "starttime", "start time", "start", "begins", "begin time",
    "event start", "start date", "start date/time",
  ],
  end_time: [
    "end_time", "endtime", "end time", "end", "ends", "event end",
    "end date", "end date/time",
  ],
  time_range: [
    "time_range", "timerange", "time range", "time", "hours", "schedule",
    "service hours", "service time", "service times", "event hours",
    "start_end", "start-end", "start_end_time", "start-end time",
  ],
  setup_time: [
    "setup_time", "setuptime", "setup time", "setup", "arrival",
    "arrival time", "load in", "loadin", "load-in",
  ],
  city: ["city", "town", "metro", "market"],
  state: ["state", "st", "state/province", "province", "region"],
  location: [
    "location", "venue", "address", "place", "site",
    "venue/location", "venue / location", "where",
  ],
  net_sales: [
    "net_sales", "netsales", "net sales", "sales", "revenue",
    "gross sales", "gross", "total sales", "total", "amount",
    "income", "gross revenue", "net revenue", "earnings",
    // SkyTab exports
    "net amount", "net total", "check total", "ticket total",
    "net check total", "revenue total", "daily net sales",
  ],
  event_type: [
    "event_type", "eventtype", "event type", "type", "category",
    "event category", "kind",
  ],
  fee_type: ["fee_type", "feetype", "fee type", "fee structure"],
  fee_rate: [
    "fee_rate", "feerate", "fee rate", "fee", "fee %", "fee percent",
    "fee amount", "commission", "commission rate",
  ],
  forecast_sales: [
    "forecast_sales", "forecastsales", "forecast sales", "forecast",
    "predicted", "predicted sales", "expected sales", "expected revenue",
    "projection", "projected sales",
  ],
  notes: [
    "notes", "note", "comments", "comment", "memo", "description",
    "details", "info",
  ],
  booked: ["booked", "confirmed", "status"],
  event_tier: ["tier", "event tier", "event_tier", "grade", "rating"],
  anomaly_flag: ["anomaly", "anomaly_flag", "flag", "disrupted", "boosted"],
  weather_type: ["weather", "weather_type", "conditions", "weather conditions"],
  expected_attendance: ["attendance", "expected attendance", "expected_attendance", "crowd size", "expected crowd"],
  sales_minimum: ["sales minimum", "sales_minimum", "minimum", "min guarantee", "guarantee"],
  event_mode: ["event_mode", "eventmode", "mode", "event mode", "truck mode", "service mode"],
  food_cost: ["food_cost", "food cost", "food", "ingredient cost", "cogs", "cost of goods", "food expense"],
  labor_cost: ["labor_cost", "labor cost", "labor", "labour", "staffing", "staff cost", "labor expense"],
  other_costs: ["other_costs", "other costs", "other", "misc", "miscellaneous", "supplies", "overhead", "fuel", "other expenses"],
};

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/['"]/g, "").replace(/[_\-]+/g, " ").trim();
}

export function matchHeader(header: string): FieldKey | null {
  const norm = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [FieldKey, string[]][]) {
    if (aliases.some((a) => a === norm)) return field;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Date, time, and value parsing
// ═══════════════════════════════════════════════════════════════════════

export function parseDate(dateStr: string): string | null {
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const mdyShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyShort) {
    const [, m, d, y] = mdyShort;
    const fullYear = parseInt(y) > 50 ? `19${y}` : `20${y}`;
    return `${fullYear}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

export function parseDatetime(value: string): { date: string | null; time: string | null } {
  const s = value.trim();
  if (!s) return { date: null, time: null };

  // Airtable ISO UTC format: "2023-03-04T22:00:00.000Z" or "2023-03-05T03:00:00.000Z"
  // Must be handled FIRST before other patterns, because Airtable stores all datetimes in UTC.
  // We convert to local time (user's browser timezone) so that e.g. 03:00 UTC = 9 PM CDT correctly
  // returns date=2023-03-04 and time=21:00, NOT the raw UTC date of 2023-03-05.
  const isoUtcMatch = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  if (isoUtcMatch) {
    const d = new Date(s); // parsed as UTC
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}`,
      };
    }
  }

  // Non-ISO formats: extract time portion from end of string, then parse date
  const timePatterns = [
    /(\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp][Mm])\s*$/,
    /(\d{1,2}:\d{2}(?::\d{2})?)\s*$/,
  ];

  let datePart = s;
  let timePart: string | null = null;

  for (const pattern of timePatterns) {
    const match = s.match(pattern);
    if (match) {
      timePart = match[1].trim();
      datePart = s.slice(0, match.index).trim().replace(/,\s*$/, "").trim();
      break;
    }
  }

  const date = parseDate(datePart);
  const normalizedTime = timePart ? normalizeTime(timePart) : null;
  return { date, time: normalizedTime };
}

export function normalizeTime(timeStr: string): string | null {
  const s = timeStr.trim();
  const ampmMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1]);
    const minutes = ampmMatch[2];
    const ampm = ampmMatch[4].toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }
  // Bare hour with AM/PM ('5 PM', '5pm') — accept and treat as :00.
  const ampmHourOnly = s.match(/^(\d{1,2})\s*([AaPp][Mm])$/);
  if (ampmHourOnly) {
    let hours = parseInt(ampmHourOnly[1]);
    const ampm = ampmHourOnly[2].toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:00`;
  }
  const h24Match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (h24Match) {
    const hours = parseInt(h24Match[1]);
    const minutes = h24Match[2];
    if (hours >= 0 && hours <= 23) return `${String(hours).padStart(2, "0")}:${minutes}`;
  }
  return null;
}

/**
 * Parse a single-column time-range value into start/end 24h strings.
 *
 * Accepts:
 *   - "5:00 PM - 9:00 PM" / "5pm-9pm" / "5–9 PM" / "11am to 3pm"
 *   - "17:00-21:00" / "17:00 — 21:00"
 *   - en-dash, em-dash, hyphen, " to " all valid separators
 *
 * Inheritance rule: if only one side has a meridiem (e.g. "5–9 PM"),
 * the other side inherits it. This is the most common ambiguity in
 * event listings and matches what a human reader would do.
 *
 * Returns { start: null, end: null } if either side fails to parse —
 * the caller surfaces a row error so the operator can fix the source
 * cell instead of getting a silently half-filled event.
 */
export function parseTimeRange(value: string): {
  start: string | null;
  end: string | null;
} {
  const s = value.trim();
  if (!s) return { start: null, end: null };
  // Split on " to " (case-insensitive) OR any dash variant. Pad
  // ascii-hyphen with whitespace handling so "5pm-9pm" splits.
  const parts = s.split(/\s*(?:\bto\b|[-–—])\s*/i);
  if (parts.length !== 2) return { start: null, end: null };
  const [rawA, rawB] = parts.map((p) => p.trim());
  if (!rawA || !rawB) return { start: null, end: null };

  // Try each side as-is first.
  let a = normalizeTime(rawA);
  let b = normalizeTime(rawB);
  if (a && b) return { start: a, end: b };

  // Meridiem inheritance: if one side parses with AM/PM and the other
  // is bare (e.g. "5–9 PM"), append the parsed meridiem to the bare
  // side and retry. We can detect "the parsed side had AM/PM" by
  // looking at the raw input.
  const hasAmpm = (raw: string) => /[AaPp][Mm]\s*$/.test(raw.trim());

  if (!a && b && hasAmpm(rawB)) {
    // Strip whatever meridiem markers the second side had and reuse
    // them on the first.
    const meridiem = rawB.match(/([AaPp][Mm])\s*$/)?.[1] ?? "";
    a = normalizeTime(`${rawA} ${meridiem}`);
    // If inheritance pushes start past end ("11–3 PM" → 23:00, 15:00),
    // flip the inferred meridiem. Events generally don't cross
    // midnight; the human reader's interpretation of "11–3 PM" is
    // 11 AM → 3 PM, not 11 PM → 3 PM.
    if (a && b && minutesOf(a) > minutesOf(b)) {
      const flipped = meridiem.toUpperCase() === "PM" ? "AM" : "PM";
      const retry = normalizeTime(`${rawA} ${flipped}`);
      if (retry && minutesOf(retry) <= minutesOf(b)) a = retry;
    }
  }
  if (!b && a && hasAmpm(rawA)) {
    const meridiem = rawA.match(/([AaPp][Mm])\s*$/)?.[1] ?? "";
    b = normalizeTime(`${rawB} ${meridiem}`);
    if (a && b && minutesOf(a) > minutesOf(b)) {
      const flipped = meridiem.toUpperCase() === "AM" ? "PM" : "AM";
      const retry = normalizeTime(`${rawB} ${flipped}`);
      if (retry && minutesOf(retry) >= minutesOf(a)) b = retry;
    }
  }

  if (a && b) return { start: a, end: b };
  return { start: null, end: null };
}

// Convert a normalized HH:MM string to a sortable minute count. Pure
// helper for the meridiem-inheritance flip logic.
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x));
  return h * 60 + m;
}

// ═══════════════════════════════════════════════════════════════════════
// Value mappers
// ═══════════════════════════════════════════════════════════════════════

export function matchFeeType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (!lower) return "none";
  const mappings: Record<string, string> = {
    none: "none", "no fee": "none", "n/a": "none",
    "flat fee": "flat_fee", flat: "flat_fee", "flat rate": "flat_fee",
    percentage: "percentage", percent: "percentage", "%": "percentage",
    commission: "commission_with_minimum",
    "commission with minimum": "commission_with_minimum",
    "commission w/ minimum": "commission_with_minimum",
    "commission w minimum": "commission_with_minimum",
    "pre-settled": "pre_settled", "pre settled": "pre_settled",
    presettled: "pre_settled", settled: "pre_settled",
    flat_fee: "flat_fee", commission_with_minimum: "commission_with_minimum",
    pre_settled: "pre_settled",
  };
  return mappings[lower] ?? "none";
}

// Includes the legacy "Private/Catering" value so CSVs that still carry
// that exact string pass the exact-match check in matchEventType and
// land as-is (lets historical data round-trip). New-event creation
// UIs offer the post-split types (Private / Wedding / Private Party /
// Reception) instead. See Commit D for the enum + UI split.
export const VALID_EVENT_TYPES = [
  "Festival", "Concert", "Community/Neighborhood", "Corporate",
  "Weekly Series", "Private", "Sports Event", "Fundraiser/Charity",
  "Wedding", "Private Party", "Reception",
  "Private/Catering", // legacy — kept for exact-match on historical CSVs
];

export function matchEventType(raw: string): string | undefined {
  const lower = raw.toLowerCase().trim();
  if (!lower) return undefined;

  const exact = VALID_EVENT_TYPES.find((t) => t.toLowerCase() === lower);
  if (exact) return exact;

  const mappings: Record<string, string> = {
    festival: "Festival", fest: "Festival",
    concert: "Concert", music: "Concert",
    community: "Community/Neighborhood", neighborhood: "Community/Neighborhood",
    farmers: "Community/Neighborhood", "farmers market": "Community/Neighborhood",
    corporate: "Corporate", office: "Corporate",
    weekly: "Weekly Series", series: "Weekly Series", recurring: "Weekly Series",
    // Post-split aliases — see Commit D + E:
    //   "private" alone = food-truck event type (truck at private venue
    //     running walk-up service). NOT a catering signal.
    //   "wedding" / "reception" / "private party" / "party" = catering-mode
    //     types introduced with Commit D.
    //   "catering" alone is deliberately NOT an event_type — it's a mode
    //     signal handled in the event-mode inference block below. A CSV
    //     cell reading literally "Catering" in the event_type column
    //     leaves event_type unset (undefined) and triggers event_mode
    //     inference to "catering".
    private: "Private",
    wedding: "Wedding",
    reception: "Reception",
    "private party": "Private Party",
    party: "Private Party",
    sports: "Sports Event", game: "Sports Event", "sports event": "Sports Event",
    fundraiser: "Fundraiser/Charity", charity: "Fundraiser/Charity",
    benefit: "Fundraiser/Charity", nonprofit: "Fundraiser/Charity",
  };

  for (const [keyword, type] of Object.entries(mappings)) {
    if (lower.includes(keyword)) return type;
  }
  // No match — return undefined so the insert layer stores null, NOT
  // the raw string. event_type is a strict Postgres enum; sending
  // unrecognized values (e.g. "Catering" after Commit E removed the
  // "catering" alias, or custom operator labels like "Brewery Pop-Up")
  // fails the whole insert batch with "invalid input value for enum
  // event_type". Better to drop the value and let the operator pick a
  // real type via edit than to reject the row. Surfaced via Julian's
  // Commit E smoke import where event_type="Catering" rows failed.
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════
// CSV helpers
// ═══════════════════════════════════════════════════════════════════════

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

// RFC 4180-compliant CSV parse. Respects double-quote quoting and CRLF
// inside quoted fields — critical for notes fields that contain newlines
// (Airtable rich-text exports, 673 of 907 rows in a recent import).
// Returns rows with each cell trimmed, matching the prior splitCSVLine
// contract so downstream field parsers are unaffected. Interior
// whitespace (including embedded newlines) inside a cell is preserved.
export function parseCSV(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });
  const data = result.data;
  if (data.length === 0) return { headers: [], rows: [] };
  const headers = (data[0] ?? []).map((h) => String(h ?? "").trim());
  const rows = data
    .slice(1)
    .map((r) => r.map((v) => (v == null ? "" : String(v).trim())));
  return { headers, rows };
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Normalize a user-supplied state input to the 2-letter US code.
 * Accepts codes ("MO", "mo") and full names ("Missouri", "missouri").
 * Returns "OTHER" pass-through. Returns undefined for unrecognized
 * input — callers show that through to preview so the operator sees
 * what needs fixing rather than silently dropping the row's state.
 */
export function normalizeStateInput(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const upper = s.toUpperCase();
  if (upper === OTHER_STATE) return OTHER_STATE;
  if (US_STATES.includes(upper)) return upper;
  // Reverse lookup full name → code.
  for (const [code, name] of Object.entries(US_STATE_NAMES)) {
    if (name.toLowerCase() === s.toLowerCase()) return code;
  }
  return undefined;
}

export function normalizeWeather(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (s === "clear" || s === "sunny") return "Clear";
  if (s === "overcast" || s === "cloudy" || s === "partly cloudy") return "Overcast";
  if (s === "hot") return "Hot";
  if (s === "cold") return "Cold";
  if (s === "rain before" || s === "rain before event") return "Rain Before Event";
  if (s === "rain during" || s === "rain during event") return "Rain During Event";
  // "Possible Rain", "light rain", "chance of rain", "drizzle" → Rain Before Event
  if (s.includes("possible rain") || s.includes("chance of rain") || s.includes("light rain") || s.includes("drizzle")) return "Rain Before Event";
  // Any other "rain" → Rain During Event
  if (s.includes("rain")) return "Rain During Event";
  if (s === "storms" || s === "storm" || s === "thunderstorm" || s.includes("thunder")) return "Storms";
  if (s === "snow" || s === "snowy" || s.includes("snow")) return "Snow";
  // Unrecognized — skip rather than send an invalid enum to the DB
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════
// Parse rows using the user's column mapping
// ═══════════════════════════════════════════════════════════════════════

export function parseWithMapping(
  dataLines: string[][],
  mappings: ColumnMapping[]
): ParsedRow[] {
  // Build a lookup: field → column index
  const fieldToIndex = new Map<FieldKey, number>();
  for (const col of mappings) {
    if (col.assignedField !== "skip") {
      fieldToIndex.set(col.assignedField, col.index);
    }
  }

  const getValue = (field: FieldKey, values: string[]): string => {
    const idx = fieldToIndex.get(field);
    if (idx === undefined) return "";
    return values[idx] ?? "";
  };

  const rows: ParsedRow[] = [];

  for (const values of dataLines) {
    // ── Event name ──
    const eventName = getValue("event_name", values).trim();
    if (!eventName) {
      rows.push({
        event_name: "(missing)",
        event_date: "(missing)",
        valid: false,
        error: "Missing event name",
      });
      continue;
    }

    // ── Resolve dates & times ──
    let eventDate: string | null = null;
    let startTime: string | null = null;
    let endTime: string | null = null;
    let setupTime: string | null = null;
    let endDate: string | null = null;

    const rawDate = getValue("event_date", values).trim();
    if (rawDate) {
      const parsed = parseDatetime(rawDate);
      eventDate = parsed.date;
    }

    const rawStart = getValue("start_time", values).trim();
    if (rawStart) {
      const parsed = parseDatetime(rawStart);
      if (!eventDate && parsed.date) eventDate = parsed.date;
      startTime = parsed.time;
    }

    const rawEnd = getValue("end_time", values).trim();
    if (rawEnd) {
      const parsed = parseDatetime(rawEnd);
      endDate = parsed.date;
      endTime = parsed.time;
    }

    // Single-column time range ("5:00 PM - 9:00 PM"). Fills start/end
    // only when the explicit columns above didn't already set them —
    // discrete columns win on conflict so an operator who maps both a
    // start/end pair AND a range column doesn't get silently
    // overwritten.
    const rawRange = getValue("time_range", values).trim();
    if (rawRange && (!startTime || !endTime)) {
      const range = parseTimeRange(rawRange);
      if (!startTime && range.start) startTime = range.start;
      if (!endTime && range.end) endTime = range.end;
    }

    const rawSetup = getValue("setup_time", values).trim();
    if (rawSetup) {
      const parsed = parseDatetime(rawSetup);
      if (!eventDate && parsed.date) eventDate = parsed.date;
      setupTime = parsed.time;
    }

    if (!eventDate) {
      rows.push({
        event_name: eventName,
        event_date: "(no date found)",
        valid: false,
        error: "No date found. Map a Date, Start Time, or Setup Time column.",
      });
      continue;
    }

    // ── Sales ──
    const rawSales = getValue("net_sales", values).trim();
    const netSales = rawSales ? parseFloat(rawSales.replace(/[$,]/g, "")) : undefined;
    const validSales = netSales !== undefined && !isNaN(netSales) ? netSales : undefined;

    // ── Event type ──
    const rawType = getValue("event_type", values).trim();
    const eventType = rawType ? matchEventType(rawType) : undefined;

    // ── Fee type ──
    // Pass undefined when the CSV didn't provide a fee_type so the
    // insert layer can distinguish "CSV said nothing" (→ apply mode-
    // aware default, e.g. pre_settled for catering) from "CSV
    // explicitly said none" (→ store "none"). Previously feeType was
    // always a string because matchFeeType("") returned "none", which
    // clobbered the insert-layer catering default.
    const rawFee = getValue("fee_type", values).trim();
    const feeType = rawFee ? matchFeeType(rawFee) : undefined;

    // ── Fee rate ──
    const rawFeeRate = getValue("fee_rate", values).trim();
    const feeRate = rawFeeRate ? parseFloat(rawFeeRate.replace(/[$,%]/g, "")) : undefined;
    const validFeeRate = feeRate !== undefined && !isNaN(feeRate) ? feeRate : undefined;

    // ── Forecast sales ──
    const rawForecast = getValue("forecast_sales", values).trim();
    const forecastSales = rawForecast ? parseFloat(rawForecast.replace(/[$,]/g, "")) : undefined;
    const validForecast = forecastSales !== undefined && !isNaN(forecastSales) ? forecastSales : undefined;

    // ── Other fields ──
    // City is canonicalized at parse time so the preview shows the
    // form the operator will see stored. Normalization happens in the
    // shared src/lib/city-normalize.ts module.
    const rawCity = getValue("city", values).trim();
    const city = rawCity ? canonicalizeCity(rawCity) : undefined;
    // State: accept 2-letter code or expand from full name via
    // US_STATE_NAMES reverse lookup. Unknown strings pass through so
    // the admin can see + fix in preview rather than silently drop.
    const rawState = getValue("state", values).trim();
    const state = rawState ? normalizeStateInput(rawState) : undefined;
    const location = getValue("location", values).trim() || undefined;
    const notes = getValue("notes", values).trim() || undefined;

    // ── Booked ──
    const rawBooked = getValue("booked", values).trim().toLowerCase();
    let booked: boolean | undefined = undefined;
    if (rawBooked) {
      if (["yes", "true", "1", "confirmed", "booked", "checked"].includes(rawBooked)) booked = true;
      else if (["no", "false", "0", "tentative", "unconfirmed", "not booked", "unbooked", "pending", "maybe", "tbd"].includes(rawBooked)) booked = false;
    }

    // ── Event tier ──
    const rawTier = getValue("event_tier", values).trim().toUpperCase();
    const eventTier = ["A", "B", "C", "D"].includes(rawTier) ? rawTier : undefined;

    // ── Anomaly flag ──
    const rawAnomaly = getValue("anomaly_flag", values).trim().toLowerCase();
    let anomalyFlag: string | undefined = undefined;
    if (rawAnomaly) {
      if (["disrupted", "disruption", "bad"].includes(rawAnomaly)) anomalyFlag = "disrupted";
      else if (["boosted", "exceptional", "great"].includes(rawAnomaly)) anomalyFlag = "boosted";
      else if (rawAnomaly) anomalyFlag = "normal";
    }

    // ── Weather type ──
    const rawWeather = getValue("weather_type", values).trim();
    const weatherType = rawWeather ? normalizeWeather(rawWeather) : undefined;

    // ── Expected attendance ──
    const rawAttendance = getValue("expected_attendance", values).trim();
    const expectedAttendance = rawAttendance ? parseInt(rawAttendance.replace(/[,]/g, ""), 10) : undefined;
    const validAttendance = expectedAttendance !== undefined && !isNaN(expectedAttendance) ? expectedAttendance : undefined;

    // ── Event mode ──
    // Precedence:
    //   1. Explicit event_mode column from CSV (existing behavior)
    //   2. Inferred from event_type column value matching catering
    //      aliases (Commit E — see EVENT_TYPE_CATERING_ALIASES below)
    //   3. Left undefined here; the import client layers batch-default
    //      + DB default ("food_truck") downstream.
    //
    // The explicit event_mode list still accepts "private" as a legacy
    // catering signal because when an operator writes "private" in the
    // MODE column they clearly mean private-catering shape. The new
    // event_type inference list is stricter — bare "private" there is
    // NOT a catering signal because "Private" is a legitimate food-
    // truck event_type (truck parked at a private venue running walk-
    // up service).
    const rawMode = getValue("event_mode", values).trim().toLowerCase();
    let eventMode: string | undefined = undefined;
    if (rawMode) {
      if (["catering", "private catering", "private", "invoice", "invoiced"].includes(rawMode)) {
        eventMode = "catering";
      } else {
        eventMode = "food_truck";
      }
    } else if (rawType) {
      // event_type → event_mode inference (strict catering aliases only).
      const lowerType = rawType.toLowerCase();
      if (
        ["catering", "private catering", "catering - private", "catering/private", "caterings"].includes(lowerType)
      ) {
        eventMode = "catering";
      }
    }

    // ── Sales minimum ──
    const rawSalesMin = getValue("sales_minimum", values).trim();
    const salesMinimum = rawSalesMin ? parseFloat(rawSalesMin.replace(/[$,]/g, "")) : undefined;
    const validSalesMinimum = salesMinimum !== undefined && !isNaN(salesMinimum) ? salesMinimum : undefined;

    // ── Cost fields ──
    const rawFoodCost = getValue("food_cost", values).trim();
    const foodCost = rawFoodCost ? parseFloat(rawFoodCost.replace(/[$,]/g, "")) : undefined;
    const validFoodCost = foodCost !== undefined && !isNaN(foodCost) && foodCost >= 0 ? foodCost : undefined;

    const rawLaborCost = getValue("labor_cost", values).trim();
    const laborCost = rawLaborCost ? parseFloat(rawLaborCost.replace(/[$,]/g, "")) : undefined;
    const validLaborCost = laborCost !== undefined && !isNaN(laborCost) && laborCost >= 0 ? laborCost : undefined;

    const rawOtherCosts = getValue("other_costs", values).trim();
    const otherCosts = rawOtherCosts ? parseFloat(rawOtherCosts.replace(/[$,]/g, "")) : undefined;
    const validOtherCosts = otherCosts !== undefined && !isNaN(otherCosts) && otherCosts >= 0 ? otherCosts : undefined;

    // ── Multi-day handling ──
    // If the event spans exactly 1 day and the end time is before 6 AM, it just ran
    // past midnight (e.g. concert ending at 1 AM) — treat as same-day, not multi-day.
    const spanDays = endDate && eventDate ? daysBetween(eventDate, endDate) : 0;
    const endHour = endTime ? parseInt(endTime.split(":")[0], 10) : 12;
    const runsPastMidnight = spanDays === 1 && endHour < 6;
    const isMultiDay =
      endDate && eventDate && endDate !== eventDate && spanDays > 0 && !runsPastMidnight;

    if (isMultiDay) {
      const numDays = Math.min(daysBetween(eventDate, endDate!), 14);
      for (let d = 0; d <= numDays; d++) {
        const thisDate = addDays(eventDate, d);
        const isFirst = d === 0;
        const isLast = d === numDays;
        rows.push({
          event_name: eventName,
          event_date: thisDate,
          start_time: isFirst ? startTime ?? undefined : undefined,
          end_time: isLast ? endTime ?? undefined : undefined,
          setup_time: isFirst ? setupTime ?? undefined : undefined,
          city, state, location,
          net_sales: isLast ? validSales : undefined,
          event_type: eventType,
          fee_type: feeType,
          fee_rate: validFeeRate,
          forecast_sales: isLast ? validForecast : undefined,
          notes,
          booked,
          event_tier: eventTier,
          anomaly_flag: anomalyFlag,
          weather_type: weatherType,
          expected_attendance: validAttendance,
          sales_minimum: validSalesMinimum,
          event_mode: eventMode,
          food_cost: isLast ? validFoodCost : undefined,
          labor_cost: isLast ? validLaborCost : undefined,
          other_costs: isLast ? validOtherCosts : undefined,
          valid: true,
          multi_day_label: `Day ${d + 1} of ${numDays + 1}`,
        });
      }
    } else {
      rows.push({
        event_name: eventName,
        event_date: eventDate,
        start_time: startTime ?? undefined,
        end_time: endTime ?? undefined,
        setup_time: setupTime ?? undefined,
        city, location,
        net_sales: validSales,
        event_type: eventType,
        fee_type: feeType,
        fee_rate: validFeeRate,
        forecast_sales: validForecast,
        notes,
        booked,
        event_tier: eventTier,
        anomaly_flag: anomalyFlag,
        weather_type: weatherType,
        expected_attendance: validAttendance,
        sales_minimum: validSalesMinimum,
        event_mode: eventMode,
        food_cost: validFoodCost,
        labor_cost: validLaborCost,
        other_costs: validOtherCosts,
        valid: true,
      });
    }
  }

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════
// Canonical CSV template
// ═══════════════════════════════════════════════════════════════════════

/**
 * The canonical CSV template shared between self-serve and admin imports.
 * Both the download button on /dashboard/integrations (self-serve) and
 * the admin import on /dashboard/admin/users/[userId] call this to
 * produce identical template bytes. Do not fork.
 *
 * Returns the CSV as a string so the caller can wrap it in whatever
 * delivery mechanism it needs (Blob + download on client, Response
 * body on a route handler, etc.).
 */
export function buildImportTemplateCsv(): string {
  const headers = [
    "event_name",
    "event_date",
    "start_time",
    "end_time",
    "city",
    "state",
    "location",
    "net_sales",
    "event_type",
    "event_tier",
    "booked",
    "fee_type",
    "fee_rate",
    "sales_minimum",
    "anomaly_flag",
    "weather",
    "expected_attendance",
    "notes",
    "food_cost",
    "labor_cost",
    "other_costs",
  ];
  const examples: string[][] = [
    [
      "Taste of St. Louis",
      "2024-09-14",
      "11:00",
      "20:00",
      "St. Louis",
      "MO",
      "Kiener Plaza",
      "3200",
      "Festival",
      "A",
      "yes",
      "percentage",
      "10",
      "",
      "normal",
      "Clear",
      "5000",
      "Great crowd this year",
      "800",
      "350",
      "120",
    ],
    [
      "Downtown Farmers Market",
      "2024-08-03",
      "08:00",
      "13:00",
      "St. Louis",
      "MO",
      "Soulard Market",
      "1450",
      "Community/Neighborhood",
      "B",
      "yes",
      "flat_fee",
      "75",
      "",
      "normal",
      "Overcast",
      "800",
      "",
    ],
  ];

  return [
    headers.join(","),
    ...examples.map((row) =>
      row.map((v) => (v.includes(",") ? `"${v}"` : v)).join(",")
    ),
  ].join("\n");
}
