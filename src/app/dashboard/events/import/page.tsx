"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Columns,
  Eye,
  Download,
  Link,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

type FieldKey =
  | "event_name"
  | "event_date"
  | "start_time"
  | "end_time"
  | "setup_time"
  | "city"
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

interface ParsedRow {
  event_name: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  setup_time?: string;
  city?: string;
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

/** A single CSV column: its original header, index, sample values, and user-assigned field */
interface ColumnMapping {
  index: number;
  originalHeader: string;
  sampleValues: string[];
  autoDetected: FieldKey | null;
  assignedField: FieldKey | "skip";
}

type Step = "upload" | "map" | "preview" | "duplicates";

type DuplicateAction = "skip" | "replace" | "keep_both";

interface DuplicateMatch {
  event_name: string;
  event_date: string;
  existing_event_id: string;
  existing_net_sales: number | null;
  action: DuplicateAction;
}

// ═══════════════════════════════════════════════════════════════════════
// Field metadata for the mapping UI
// ═══════════════════════════════════════════════════════════════════════

const FIELD_OPTIONS: { value: FieldKey | "skip"; label: string; description: string }[] = [
  { value: "skip", label: "Skip this column", description: "Don't import" },
  { value: "event_name", label: "Event Name", description: "Required — name of the event" },
  { value: "event_date", label: "Date", description: "Event date (various formats)" },
  { value: "start_time", label: "Start Time", description: "Can include date + time" },
  { value: "end_time", label: "End Time", description: "Can include date + time" },
  { value: "setup_time", label: "Setup Time", description: "Can include date + time" },
  { value: "city", label: "City", description: "City name" },
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
const BASIC_FIELD_VALUES: (FieldKey | "skip")[] = [
  "skip",
  "event_name",
  "event_date",
  "start_time",
  "end_time",
  "city",
  "location",
  "net_sales",
  "event_type",
  "booked",
];

const ADVANCED_FIELD_VALUES: (FieldKey | "skip")[] = [
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

const COLUMN_ALIASES: Record<FieldKey, string[]> = {
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
  setup_time: [
    "setup_time", "setuptime", "setup time", "setup", "arrival",
    "arrival time", "load in", "loadin", "load-in",
  ],
  city: ["city", "town", "metro", "market"],
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

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/['"]/g, "").replace(/[_\-]+/g, " ").trim();
}

function matchHeader(header: string): FieldKey | null {
  const norm = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [FieldKey, string[]][]) {
    if (aliases.some((a) => a === norm)) return field;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Date, time, and value parsing
// ═══════════════════════════════════════════════════════════════════════

function parseDate(dateStr: string): string | null {
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

function parseDatetime(value: string): { date: string | null; time: string | null } {
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

function normalizeTime(timeStr: string): string | null {
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
  const h24Match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (h24Match) {
    const hours = parseInt(h24Match[1]);
    const minutes = h24Match[2];
    if (hours >= 0 && hours <= 23) return `${String(hours).padStart(2, "0")}:${minutes}`;
  }
  return null;
}

// ── Value mappers ────────────────────────────────────────────────────

function matchFeeType(raw: string): string {
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

const VALID_EVENT_TYPES = [
  "Festival", "Concert", "Community/Neighborhood", "Corporate",
  "Weekly Series", "Private/Catering", "Sports Event", "Fundraiser/Charity",
];

function matchEventType(raw: string): string | undefined {
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
    private: "Private/Catering", catering: "Private/Catering",
    wedding: "Private/Catering", party: "Private/Catering",
    sports: "Sports Event", game: "Sports Event", "sports event": "Sports Event",
    fundraiser: "Fundraiser/Charity", charity: "Fundraiser/Charity",
    benefit: "Fundraiser/Charity", nonprofit: "Fundraiser/Charity",
  };

  for (const [keyword, type] of Object.entries(mappings)) {
    if (lower.includes(keyword)) return type;
  }
  return raw.trim() || undefined;
}

// ── CSV helpers ──────────────────────────────────────────────────────

function splitCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeWeather(raw: string): string | undefined {
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

function parseWithMapping(
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
    const rawFee = getValue("fee_type", values).trim();
    const feeType = matchFeeType(rawFee);

    // ── Fee rate ──
    const rawFeeRate = getValue("fee_rate", values).trim();
    const feeRate = rawFeeRate ? parseFloat(rawFeeRate.replace(/[$,%]/g, "")) : undefined;
    const validFeeRate = feeRate !== undefined && !isNaN(feeRate) ? feeRate : undefined;

    // ── Forecast sales ──
    const rawForecast = getValue("forecast_sales", values).trim();
    const forecastSales = rawForecast ? parseFloat(rawForecast.replace(/[$,]/g, "")) : undefined;
    const validForecast = forecastSales !== undefined && !isNaN(forecastSales) ? forecastSales : undefined;

    // ── Other fields ──
    const city = getValue("city", values).trim() || undefined;
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
    const rawMode = getValue("event_mode", values).trim().toLowerCase();
    let eventMode: string | undefined = undefined;
    if (rawMode) {
      if (["catering", "private catering", "private", "invoice", "invoiced"].includes(rawMode)) {
        eventMode = "catering";
      } else {
        eventMode = "food_truck";
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
          city, location,
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
// Component
// ═══════════════════════════════════════════════════════════════════════

export default function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [importSource, setImportSource] = useState<"csv" | "sheets">("csv");
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [dataLines, setDataLines] = useState<string[][]>([]);

  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);

  const router = useRouter();
  const supabase = createClient();
  const dragCounter = useRef(0);

  // ── Step 1: Upload ──

  function processCSVText(text: string, sourceName: string) {
    setRawText(text);
    setFileName(sourceName);

    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      setImportError("The file appears to be empty or has only one row.");
      return;
    }

    const headers = splitCSVLine(lines[0]);
    const parsedDataLines: string[][] = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      parsedDataLines.push(splitCSVLine(lines[i]));
    }
    setDataLines(parsedDataLines);

    // Build initial column mappings with auto-detection
    const mappings: ColumnMapping[] = headers.map((h, idx) => {
      const detected = matchHeader(h);
      const samples = parsedDataLines.slice(0, 3).map((row) => row[idx] ?? "");
      return {
        index: idx,
        originalHeader: h.trim(),
        sampleValues: samples,
        autoDetected: detected,
        assignedField: detected ?? "skip",
      };
    });

    setColumnMappings(mappings);
    setStep("map");
    setImported(false);
    setImportError(null);
  }

  function processFile(file: File) {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setImportError("Please upload a CSV file (.csv)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      processCSVText(reader.result as string, file.name);
    };
    reader.readAsText(file);
  }

  async function handleLoadSheet() {
    const url = sheetsUrl.trim();
    if (!url) return;
    setSheetsLoading(true);
    setSheetsError(null);
    try {
      const res = await fetch(
        `/api/import/google-sheets?url=${encodeURIComponent(url)}`
      );
      const body = res.headers.get("content-type")?.includes("text/csv")
        ? await res.text()
        : await res.json();

      if (!res.ok) {
        setSheetsError(
          typeof body === "object" ? body.error : "Failed to load sheet."
        );
        return;
      }
      processCSVText(body as string, "Google Sheet");
    } catch {
      setSheetsError("Network error — check your connection and try again.");
    } finally {
      setSheetsLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  // ── Step 2: Column mapping ──

  const updateMapping = useCallback(
    (index: number, field: FieldKey | "skip") => {
      setColumnMappings((prev) =>
        prev.map((col) =>
          col.index === index ? { ...col, assignedField: field } : col
        )
      );
    },
    []
  );

  const hasEventName = columnMappings.some((c) => c.assignedField === "event_name");
  const hasDateSource = columnMappings.some(
    (c) =>
      c.assignedField === "event_date" ||
      c.assignedField === "start_time" ||
      c.assignedField === "setup_time"
  );
  const canProceed = hasEventName && hasDateSource;

  // ── Step 3: Preview (computed from current mappings) ──

  const parsedRows = useMemo(() => {
    if ((step !== "preview" && step !== "duplicates") || dataLines.length === 0) return [];
    return parseWithMapping(dataLines, columnMappings);
  }, [step, dataLines, columnMappings]);

  const validCount = parsedRows.filter((r) => r.valid).length;
  const invalidCount = parsedRows.filter((r) => !r.valid).length;

  // Count of events that will actually be imported given current duplicate actions
  const dupActionMap = new Map(duplicates.map((d) => [`${d.event_name}|${d.event_date}`, d.action]));
  const importableCount = parsedRows.filter((r) => {
    if (!r.valid) return false;
    const action = dupActionMap.get(`${r.event_name}|${r.event_date}`);
    if (!action) return true; // not a duplicate
    return action !== "skip";
  }).length;
  const multiDayCount = parsedRows.filter((r) => r.multi_day_label).length;

  // ── Duplicate check ──

  async function handleCheckDuplicates() {
    const validRows = parsedRows.filter((r) => r.valid);
    if (validRows.length === 0) return;

    setCheckingDuplicates(true);
    try {
      const res = await fetch("/api/events/check-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: validRows.map((r) => ({
            event_name: r.event_name,
            event_date: r.event_date,
          })),
        }),
      });
      const data = await res.json();
      const found: DuplicateMatch[] = (data.duplicates ?? []).map(
        (d: Omit<DuplicateMatch, "action">) => ({ ...d, action: "skip" as DuplicateAction })
      );
      if (found.length > 0) {
        setDuplicates(found);
        setStep("duplicates");
      } else {
        setDuplicates([]);
        // No duplicates — go straight to import
        await runImport([]);
      }
    } catch {
      setImportError("Failed to check for duplicates. Proceeding with import.");
      await runImport([]);
    } finally {
      setCheckingDuplicates(false);
    }
  }

  function updateDuplicateAction(index: number, action: DuplicateAction) {
    setDuplicates((prev) =>
      prev.map((d, i) => (i === index ? { ...d, action } : d))
    );
  }

  function setBulkAction(action: DuplicateAction) {
    setDuplicates((prev) => prev.map((d) => ({ ...d, action })));
  }

  // ── Import ──

  async function handleImport() {
    await runImport(duplicates);
  }

  async function runImport(resolvedDuplicates: DuplicateMatch[]) {
    // Build a map of duplicate actions keyed by event_name|event_date
    const dupActionMap = new Map<string, DuplicateAction>();
    for (const d of resolvedDuplicates) {
      dupActionMap.set(`${d.event_name}|${d.event_date}`, d.action);
    }

    const validRows = parsedRows.filter((r) => r.valid);
    if (validRows.length === 0) {
      setImportError(`No valid rows found in parsed data (total parsed: ${parsedRows.length}). Please go back to step 1 and re-upload your file.`);
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportProgress(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setImportError("Not authenticated. Please log in and try again.");
      setImporting(false);
      return;
    }

    // Filter rows based on duplicate actions
    const rowsToInsert = validRows.filter((r) => {
      const action = dupActionMap.get(`${r.event_name}|${r.event_date}`);
      if (!action) return true; // not a duplicate
      return action !== "skip"; // keep if replace or keep_both
    });

    // For "replace" action, delete existing events first
    const replaceIds = resolvedDuplicates
      .filter((d) => d.action === "replace")
      .map((d) => d.existing_event_id);

    if (replaceIds.length > 0) {
      // If replacing most/all events, delete all at once to avoid .in() size limits
      const allDuplicateIds = resolvedDuplicates.map((d) => d.existing_event_id);
      const replacingAll = replaceIds.length === allDuplicateIds.length;

      if (replacingAll) {
        const { error: delError } = await supabase.from("events").delete().eq("user_id", user.id);
        if (delError) {
          setImportError(`Delete failed: ${delError.message}`);
          setImporting(false);
          return;
        }
      } else {
        const CHUNK = 100;
        for (let i = 0; i < replaceIds.length; i += CHUNK) {
          const { error: delError } = await supabase.from("events").delete().in("id", replaceIds.slice(i, i + CHUNK));
          if (delError) {
            setImportError(`Delete failed: ${delError.message}`);
            setImporting(false);
            return;
          }
        }
      }
    }

    const insertData = rowsToInsert.map((r) => ({
      user_id: user.id,
      event_name: r.event_name,
      event_date: r.event_date,
      start_time: r.start_time ?? null,
      end_time: r.end_time ?? null,
      setup_time: r.setup_time ?? null,
      city: r.city ?? null,
      net_sales: r.net_sales ?? null,
      event_type: r.event_type ?? null,
      location: r.location ?? null,
      fee_type: matchFeeType(r.fee_type ?? ""),
      fee_rate: r.fee_rate ?? 0,
      sales_minimum: r.sales_minimum ?? 0,
      forecast_sales: r.forecast_sales ?? null,
      notes: r.notes ?? null,
      booked: r.booked !== undefined ? r.booked : true, // default true — historical imports are confirmed events
      event_tier: r.event_tier ?? null,
      anomaly_flag: r.anomaly_flag ?? "normal",
      event_weather: r.weather_type ?? null,
      expected_attendance: r.expected_attendance ?? null,
      event_mode: (r.event_mode === "catering" ? "catering" : "food_truck") as "food_truck" | "catering",
      pos_source: "manual" as const,
      // Cost fields — only included when non-null to avoid errors if migration hasn't been applied yet
      ...(r.food_cost !== undefined ? { food_cost: r.food_cost } : {}),
      ...(r.labor_cost !== undefined ? { labor_cost: r.labor_cost } : {}),
      ...(r.other_costs !== undefined ? { other_costs: r.other_costs } : {}),
    }));

    if (insertData.length === 0) {
      setImportError(`Nothing to insert — rowsToInsert was empty. Valid rows: ${validRows.length}, duplicates: ${resolvedDuplicates.length}, actions: ${resolvedDuplicates.map(d => d.action).join(",").slice(0, 100)}`);
      setImporting(false);
      return;
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
      const batch = insertData.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(insertData.length / BATCH_SIZE);
      setImportProgress(
        `Importing batch ${batchNum} of ${totalBatches} (${totalInserted} / ${insertData.length})...`
      );

      const { error } = await supabase.from("events").insert(batch);
      if (error) {
        // Batch failed — fall back to row-by-row so one bad row doesn't kill the whole batch
        let rowsInsertedInBatch = 0;
        for (let j = 0; j < batch.length; j++) {
          const { error: rowError } = await supabase.from("events").insert(batch[j]);
          if (rowError) {
            const rowNum = i + j + 1;
            const eventName = (batch[j] as { event_name: string }).event_name ?? `row ${rowNum}`;
            errors.push(`Row ${rowNum} "${eventName}": ${rowError.message}`);
          } else {
            rowsInsertedInBatch++;
          }
        }
        totalInserted += rowsInsertedInBatch;
      } else {
        totalInserted += batch.length;
      }
    }

    if (totalInserted > 0) {
      setImportProgress("Recalculating forecasts and performance...");
      try {
        await fetch("/api/recalculate", { method: "POST" });
      } catch {
        // Non-critical
      }
      setImported(true);
      setImportCount(totalInserted);
    }

    if (errors.length > 0) {
      setImportError(`${errors.length} batch(es) failed:\n${errors.join("\n")}`);
    }

    setImportProgress(null);
    setImporting(false);
  }

  // ── CSV Template Download ──

  function handleDownloadTemplate() {
    const headers = [
      "event_name",
      "event_date",
      "start_time",
      "end_time",
      "city",
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
    const examples = [
      [
        "Taste of St. Louis",
        "2024-09-14",
        "11:00",
        "20:00",
        "St. Louis",
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

    const csvContent = [
      headers.join(","),
      ...examples.map((row) =>
        row.map((v) => (v.includes(",") ? `"${v}"` : v)).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vendcast-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Reset ──

  function handleReset() {
    setStep("upload");
    setRawText("");
    setFileName("");
    setColumnMappings([]);
    setDataLines([]);
    setImported(false);
    setImportError(null);
    setImportProgress(null);
    setDuplicates([]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Import Events</h1>
          <p className="text-muted-foreground">
            Upload a CSV file to import historical events
          </p>
          <a
            href="/dashboard/events/import/historical"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
          >
            Already using Square or Clover? Pull sales by date range →
          </a>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="shrink-0 gap-2">
          <Download className="h-4 w-4" />
          Download CSV Template
        </Button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: "upload", label: "1. Upload", icon: Upload },
          { key: "map", label: "2. Map Columns", icon: Columns },
          { key: "preview", label: "3. Preview & Import", icon: Eye },
          { key: "duplicates", label: "4. Duplicates", icon: AlertCircle },
        ].map(({ key, label, icon: Icon }, i) => (
          <div key={key} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                step === key
                  ? "bg-primary text-primary-foreground"
                  : (key === "upload" || (key === "map" && (step === "preview" || step === "duplicates")) || (key === "preview" && step === "duplicates"))
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted/50 text-muted-foreground/60"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Events
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Source toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => { setImportSource("csv"); setSheetsError(null); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  importSource === "csv"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                <FileText className="h-4 w-4" />
                Upload CSV
              </button>
              <button
                onClick={() => { setImportSource("sheets"); setSheetsError(null); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  importSource === "sheets"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                <Link className="h-4 w-4" />
                Google Sheets
              </button>
            </div>

            {/* CSV upload */}
            {importSource === "csv" && (
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
              >
                <Upload className={`h-10 w-10 mx-auto mb-4 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                {isDragging ? (
                  <p className="text-sm font-medium text-primary mb-4">Drop your CSV file here</p>
                ) : (
                  <>
                    <p className="text-sm font-medium mb-1">
                      Drag &amp; drop your CSV here, or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Works with Airtable, Square, Excel, SkyTab, or any spreadsheet export
                    </p>
                  </>
                )}
                <label className={`inline-flex items-center gap-2 cursor-pointer px-4 py-2 rounded-md text-sm font-medium transition-colors ${isDragging ? "invisible" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
                  <FileText className="h-4 w-4" />
                  Choose CSV file
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
              </div>
            )}

            {/* Google Sheets URL */}
            {importSource === "sheets" && (
              <div className="space-y-3">
                <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 text-sm text-blue-800 dark:text-blue-300 space-y-1">
                  <p className="font-medium">Before you paste your link:</p>
                  <p className="text-xs">In Google Sheets, click <strong>Share</strong> → set to <strong>&ldquo;Anyone with the link can view&rdquo;</strong>. Your data stays private — we only read it once to import.</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={sheetsUrl}
                    onChange={(e) => { setSheetsUrl(e.target.value); setSheetsError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleLoadSheet(); }}
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={handleLoadSheet}
                    disabled={!sheetsUrl.trim() || sheetsLoading}
                  >
                    {sheetsLoading ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</>
                    ) : (
                      <>Import <ArrowRight className="h-4 w-4 ml-1" /></>
                    )}
                  </Button>
                </div>
                {sheetsError && (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{sheetsError}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Map Columns ── */}
      {step === "map" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Columns className="h-5 w-5" />
                  Map Your Columns
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  We auto-detected what we could. Use the dropdowns to assign or change any column.
                  You need at least an <strong>Event Name</strong> and a <strong>Date</strong>.
                </p>
              </div>
              <div className="flex gap-2 shrink-0 mt-1">
                <Button size="sm" variant="outline" onClick={handleReset}>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                  Back
                </Button>
                <Button size="sm" disabled={!canProceed} onClick={() => setStep("preview")}>
                  Preview
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {fileName && (
              <p className="text-sm">
                File: <span className="font-medium">{fileName}</span>
                {" — "}
                {dataLines.length} data rows, {columnMappings.length} columns
              </p>
            )}

            {/* Advanced options toggle */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing basic fields. Advanced fields (weather, anomaly, fees, costs) are hidden by default.
              </p>
              <button
                type="button"
                onClick={() => setShowAdvancedFields((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline shrink-0"
              >
                {showAdvancedFields ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {showAdvancedFields ? "Hide advanced options" : "Show advanced options"}
              </button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Your Column</TableHead>
                    <TableHead className="w-64">Maps To</TableHead>
                    <TableHead>Sample Values</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columnMappings.map((col) => (
                    <TableRow
                      key={col.index}
                      className={
                        col.assignedField === "skip" ? "opacity-50" : ""
                      }
                    >
                      <TableCell className="font-medium">
                        {col.originalHeader}
                        {col.autoDetected && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs text-green-700 border-green-300"
                          >
                            auto
                          </Badge>
                        )}
                        {/* Badge if this column is mapped to an advanced field */}
                        {ADVANCED_FIELD_VALUES.includes(col.assignedField) && col.assignedField !== "skip" && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs text-indigo-700 border-indigo-300"
                          >
                            advanced
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={col.assignedField}
                          onValueChange={(val) =>
                            updateMapping(col.index, val as FieldKey | "skip")
                          }
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Always show basic fields */}
                            {FIELD_OPTIONS.filter((opt) =>
                              BASIC_FIELD_VALUES.includes(opt.value)
                            ).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                <span>{opt.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {opt.description}
                                </span>
                              </SelectItem>
                            ))}
                            {/* Advanced fields — shown when toggle is on, or when current value is an advanced field */}
                            {(showAdvancedFields || ADVANCED_FIELD_VALUES.includes(col.assignedField)) && (
                              <>
                                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t mt-1 pt-2">
                                  Advanced
                                </div>
                                {FIELD_OPTIONS.filter((opt) =>
                                  ADVANCED_FIELD_VALUES.includes(opt.value)
                                ).map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    <span>{opt.label}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {opt.description}
                                    </span>
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                        {col.sampleValues
                          .filter(Boolean)
                          .slice(0, 3)
                          .map((v, i) => (
                            <span key={i}>
                              {i > 0 && (
                                <span className="mx-1 text-muted-foreground/40">|</span>
                              )}
                              <span className="bg-muted px-1.5 py-0.5 rounded">
                                {v.length > 40 ? v.slice(0, 40) + "..." : v}
                              </span>
                            </span>
                          ))}
                        {col.sampleValues.filter(Boolean).length === 0 && (
                          <span className="italic">(empty)</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {!canProceed && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                Please map at least an <strong>Event Name</strong> column and a{" "}
                <strong>Date</strong> (or Start Time / Setup Time) column to continue.
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleReset}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                disabled={!canProceed}
                onClick={() => setStep("preview")}
              >
                Preview Import
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Duplicates ── */}
      {step === "duplicates" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                  Duplicate Detection
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  We found {duplicates.length} potential duplicate{duplicates.length !== 1 ? "s" : ""} (same event name + date already in your account).
                  Choose how to handle each one, then click Import.
                </p>
              </div>
              {!imported && (
                <div className="flex gap-2 shrink-0 mt-1">
                  <Button size="sm" variant="outline" onClick={() => setStep("preview")}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleImport}
                    disabled={importing || importableCount === 0}
                  >
                    {importing ? "Importing..." : `Import ${importableCount}`}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Bulk actions */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Bulk action:</span>
              <Button size="sm" variant="outline" onClick={() => setBulkAction("skip")}>
                Skip All Duplicates
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkAction("replace")}>
                Replace All
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkAction("keep_both")}>
                Keep All
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Existing Sales</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {duplicates.map((dup, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{dup.event_name}</TableCell>
                      <TableCell>{dup.event_date}</TableCell>
                      <TableCell>
                        {dup.existing_net_sales !== null
                          ? `$${dup.existing_net_sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "No sales recorded"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={dup.action}
                          onValueChange={(val) =>
                            updateDuplicateAction(i, val as DuplicateAction)
                          }
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">Skip</SelectItem>
                            <SelectItem value="replace">Replace</SelectItem>
                            <SelectItem value="keep_both">Keep Both</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {importError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                {importError}
              </div>
            )}

            {importProgress && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {importProgress}
              </div>
            )}

            {imported ? (
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-green-700 font-medium">
                  Successfully imported {importCount} events!
                </span>
                <Button variant="outline" onClick={() => router.push("/dashboard/events")}>
                  View Events
                </Button>
                <Button variant="ghost" onClick={handleReset}>
                  Import More
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => setStep("preview")}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button onClick={handleImport} disabled={importing || importableCount === 0}>
                  {importing ? "Importing..." : `Import ${importableCount} Events`}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Preview & Import ── */}
      {step === "preview" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Preview & Import
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Review your data before importing. Valid rows are ready to go.
                </p>
              </div>
              {!imported && (
                <div className="flex gap-2 shrink-0 mt-1">
                  <Button size="sm" variant="outline" onClick={() => setStep("map")}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCheckDuplicates}
                    disabled={checkingDuplicates || importing || validCount === 0}
                  >
                    {checkingDuplicates ? "Checking..." : `Import ${validCount} Events`}
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary badges */}
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                {validCount} valid
              </Badge>
              {invalidCount > 0 && (
                <Badge variant="secondary" className="bg-red-100 text-red-800">
                  {invalidCount} errors
                </Badge>
              )}
              {multiDayCount > 0 && (
                <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                  {multiDayCount} multi-day rows
                </Badge>
              )}
            </div>

            {/* Parse errors */}
            {invalidCount > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                <p className="text-sm font-medium text-amber-800">
                  {invalidCount} row(s) have errors and will be skipped:
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5 max-h-32 overflow-y-auto">
                  {parsedRows
                    .filter((r) => !r.valid)
                    .map((r, i) => (
                      <li key={i}>
                        <span className="font-medium">{r.event_name}</span>
                        {" — "}
                        {r.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {/* Data preview table */}
            <div className="max-h-96 overflow-y-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Status</TableHead>
                    <TableHead>Event Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Sales</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? "" : "bg-red-50"}>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.event_name}
                        {row.multi_day_label && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs text-purple-700 border-purple-300"
                          >
                            {row.multi_day_label}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.event_date}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[
                          row.setup_time && `Setup: ${row.setup_time}`,
                          row.start_time && `Start: ${row.start_time}`,
                          row.end_time && `End: ${row.end_time}`,
                        ]
                          .filter(Boolean)
                          .join(" | ") || "—"}
                      </TableCell>
                      <TableCell>{row.city ?? "—"}</TableCell>
                      <TableCell>
                        {row.net_sales !== undefined
                          ? `$${row.net_sales.toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{row.event_type ?? "—"}</TableCell>
                      <TableCell className="text-xs">{row.fee_type ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-32 truncate">
                        {row.valid ? row.notes ?? "" : row.error}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Import errors */}
            {importError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 whitespace-pre-wrap">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertCircle className="h-4 w-4" />
                  Import Error
                </div>
                {importError}
              </div>
            )}

            {/* Progress */}
            {importProgress && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {importProgress}
              </div>
            )}

            {/* Actions */}
            {imported ? (
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-green-700 font-medium">
                  Successfully imported {importCount} events!
                </span>
                <Button
                  variant="outline"
                  onClick={() => router.push("/dashboard/events")}
                >
                  View Events
                </Button>
                <Button variant="ghost" onClick={handleReset}>
                  Import More
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => setStep("map")}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Adjust Mapping
                </Button>
                <Button
                  onClick={handleCheckDuplicates}
                  disabled={checkingDuplicates || importing || validCount === 0}
                >
                  {checkingDuplicates
                    ? "Checking..."
                    : `Import ${validCount} Events`}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
