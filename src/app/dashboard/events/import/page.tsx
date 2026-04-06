"use client";

import { useState, useMemo, useCallback } from "react";
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
  | "sales_minimum";

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
      if (["yes", "true", "1", "confirmed"].includes(rawBooked)) booked = true;
      else if (["no", "false", "0", "tentative", "unconfirmed"].includes(rawBooked)) booked = false;
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
    const weatherType = getValue("weather_type", values).trim() || undefined;

    // ── Expected attendance ──
    const rawAttendance = getValue("expected_attendance", values).trim();
    const expectedAttendance = rawAttendance ? parseInt(rawAttendance.replace(/[,]/g, ""), 10) : undefined;
    const validAttendance = expectedAttendance !== undefined && !isNaN(expectedAttendance) ? expectedAttendance : undefined;

    // ── Sales minimum ──
    const rawSalesMin = getValue("sales_minimum", values).trim();
    const salesMinimum = rawSalesMin ? parseFloat(rawSalesMin.replace(/[$,]/g, "")) : undefined;
    const validSalesMinimum = salesMinimum !== undefined && !isNaN(salesMinimum) ? salesMinimum : undefined;

    // ── Multi-day handling ──
    const isMultiDay =
      endDate && eventDate && endDate !== eventDate && daysBetween(eventDate, endDate) > 0;

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

  const router = useRouter();
  const supabase = createClient();

  // ── Step 1: Upload ──

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setRawText(text);

      const lines = text.trim().split("\n");
      if (lines.length < 2) return;

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
    };
    reader.readAsText(file);
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
    if (step !== "preview" || dataLines.length === 0) return [];
    return parseWithMapping(dataLines, columnMappings);
  }, [step, dataLines, columnMappings]);

  const validCount = parsedRows.filter((r) => r.valid).length;
  const invalidCount = parsedRows.filter((r) => !r.valid).length;
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
    if (validRows.length === 0) return;

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
      await supabase.from("events").delete().in("id", replaceIds);
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
      booked: r.booked !== undefined ? r.booked : false,
      event_tier: r.event_tier ?? null,
      anomaly_flag: r.anomaly_flag ?? "normal",
      event_weather: r.weather_type ?? null,
      expected_attendance: r.expected_attendance ?? null,
      pos_source: "manual" as const,
    }));

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
        errors.push(`Batch ${batchNum} (rows ${i + 1}-${i + batch.length}): ${error.message}`);
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
    a.download = "truckcast-import-template.csv";
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
              Upload CSV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-2">
                Upload a CSV from Airtable, Square, Excel, Google Sheets, or any spreadsheet
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                We&apos;ll auto-detect your columns, then let you adjust the mapping
                before importing. Any format works — you tell us what each column means.
              </p>
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="max-w-xs mx-auto"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Map Columns ── */}
      {step === "map" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Columns className="h-5 w-5" />
              Map Your Columns
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              We auto-detected what we could. Use the dropdowns to assign or change any column.
              You need at least an <strong>Event Name</strong> and a <strong>Date</strong> (or Start/Setup Time with a date).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {fileName && (
              <p className="text-sm">
                File: <span className="font-medium">{fileName}</span>
                {" — "}
                {dataLines.length} data rows, {columnMappings.length} columns
              </p>
            )}

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
                            {FIELD_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                <span>{opt.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {opt.description}
                                </span>
                              </SelectItem>
                            ))}
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
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Duplicate Detection
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              We found {duplicates.length} potential duplicate{duplicates.length !== 1 ? "s" : ""} (same event name + date already in your account).
              Choose how to handle each one, then click Import.
            </p>
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
                <Button onClick={handleImport} disabled={importing}>
                  {importing ? "Importing..." : `Import ${validCount} Events`}
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
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Preview & Import
            </CardTitle>
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
