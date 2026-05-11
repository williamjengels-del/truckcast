"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Search,
  DollarSign,
  Pencil,
  Trash2,
  Calendar,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  LayoutList,
  CalendarDays,
  Columns2,
  ChevronLeft,
  ChevronRight,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  Zap,
  Share2,
  Copy,
  Check,
  Download,
  CloudLightning,
  Heart,
  CopyPlus,
  BookCheck,
  RefreshCw,
  X,
  Phone,
  Mail,
  MessageSquare,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EventForm } from "@/components/event-form";
import { SalesEntryDialog } from "@/components/sales-entry-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createEvent,
  createMultiDayEvents,
  updateEvent,
  deleteEvent,
  deleteAllEvents,
  dismissFlaggedEvent,
} from "@/app/dashboard/events/actions";
import { WEATHER_COEFFICIENTS, US_STATE_NAMES } from "@/lib/constants";
import { cityGeocodeCandidates } from "@/lib/weather";
import { csvSafeDocument } from "@/lib/csv-safe";
import type { Event, Contact } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";
import { DataImportTrigger } from "@/components/data-import-guide";
import { ForecastInline } from "@/components/forecast-card";
import { isFixedRevenueEvent, fixedRevenueAmount } from "@/lib/forecast-display";
import {
  CHIP_CATALOG,
  TAB_DEFAULT_CHIPS,
  type EventsTab,
  applyChips,
  toggleChip,
  chipsToParam,
  chipsFromParam,
  eventInTabScope,
  legacyUrlMapping,
  isValidTab,
} from "@/lib/events-chips";

type SortField =
  | "event_date"
  | "event_name"
  | "event_type"
  | "event_tier"
  | "location"
  | "net_sales"
  | "net_after_fees"
  | "forecast_sales"
  | "net_profit";
type SortDirection = "asc" | "desc";
type ViewMode = "list" | "split" | "calendar";

// Chip-foundation refactor (2026-04-30): TabMode collapsed from 7
// values to 4 (all/upcoming/past/needs_attention). Status filtering
// (booked/unbooked/cancelled) and field filtering (missing-type, etc.)
// move to chips. See src/lib/events-chips.ts. Tab type is the EventsTab
// re-export so existing call sites still type-check.
type TabMode = EventsTab;

interface WeatherForecast {
  tempHigh: number;
  tempLow: number;
  wmoCode: number;
}

interface EventsClientProps {
  initialEvents: Event[];
  userId?: string;
  businessName?: string;
  userCity?: string;
  /** Operator's profile state code — pinned to top of dropdown, not a default. */
  userState?: string;
  /** Owner viewers + admins always true. Manager viewers only when their
   *  owner has flipped Financials access on. When false, hide all
   *  sales-entry CTAs (the dollar fields are already null'd server-
   *  side, so headline numbers and forecast inlines collapse on their
   *  own). */
  canSeeFinancials?: boolean;
  /** All operator-owned contacts. The client builds an event_id →
   *  contact map to render inline contact pills on each event card
   *  without N+1 fetches. May be empty for new operators. */
  contacts?: Contact[];
}

// WMO weather code to icon/label
function getWeatherInfo(code: number): { icon: React.ReactNode; label: string } {
  if (code === 0) return { icon: <Sun className="h-3.5 w-3.5 text-yellow-500" />, label: "Clear" };
  if (code <= 3) return { icon: <Cloud className="h-3.5 w-3.5 text-gray-400" />, label: "Partly Cloudy" };
  if (code <= 48) return { icon: <Cloud className="h-3.5 w-3.5 text-gray-500" />, label: "Foggy" };
  if (code <= 67) return { icon: <CloudRain className="h-3.5 w-3.5 text-blue-500" />, label: "Rain" };
  if (code <= 77) return { icon: <CloudSnow className="h-3.5 w-3.5 text-blue-200" />, label: "Snow" };
  if (code <= 82) return { icon: <CloudRain className="h-3.5 w-3.5 text-blue-600" />, label: "Rain Showers" };
  if (code <= 86) return { icon: <CloudSnow className="h-3.5 w-3.5 text-blue-300" />, label: "Snow Showers" };
  return { icon: <Zap className="h-3.5 w-3.5 text-yellow-600" />, label: "Thunderstorm" };
}

// Tiny weather icon for calendar cells (smaller)
function getWeatherIconSmall(code: number): React.ReactNode {
  if (code === 0) return <Sun className="h-3 w-3 text-yellow-500" />;
  if (code <= 3) return <Cloud className="h-3 w-3 text-gray-400" />;
  if (code <= 48) return <Cloud className="h-3 w-3 text-gray-500" />;
  if (code <= 67) return <CloudRain className="h-3 w-3 text-blue-500" />;
  if (code <= 77) return <CloudSnow className="h-3 w-3 text-blue-200" />;
  if (code <= 82) return <CloudRain className="h-3 w-3 text-blue-600" />;
  if (code <= 86) return <CloudSnow className="h-3 w-3 text-blue-300" />;
  return <Zap className="h-3 w-3 text-yellow-600" />;
}

// Pure formatters — hoisted so the module-scope components below can
// use them without needing an EventsClient closure.
function formatCurrency(val: number | null) {
  if (val === null || val === undefined) return "—";
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Compact 12-hour time renderer for calendar cells + tooltip previews.
// Mirrors formatTimeHHMM in src/components/day-of-event-block.tsx —
// kept inline rather than DRY-extracted because the broader event-time
// formatter cleanup is its own pass. Both call sites format the same
// "HH:MM" event_time strings the same way.
function formatTimeHHMM(t: string | null | undefined): string | null {
  if (!t) return null;
  const [hh, mm] = t.split(":");
  const h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  if (isNaN(h) || isNaN(m)) return null;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minStr = m.toString().padStart(2, "0");
  return `${hour12}:${minStr} ${period}`;
}

// Status-color classes for calendar event chips. Rohini flagged 2026-05-06
// that booked/cancelled status wasn't visible at-a-glance on the calendar
// view. Three discrete states; catering border-stripe (separate concern)
// composes on top.
function calendarEventClasses(event: Event): string {
  if (event.cancellation_reason) {
    // Cancelled — destructive tint, line-through, dimmed.
    return "bg-destructive/5 text-destructive/70 border-destructive/30 line-through";
  }
  if (!event.booked) {
    // Unbooked / prospecting — neutral, dashed border to read as "not yet committed".
    return "bg-muted/40 text-muted-foreground border-dashed border-border";
  }
  // Booked (default) — current treatment, brand-primary tint.
  return "bg-primary/10 text-primary border-primary/20";
}

// SortIcon — small per-column helper. Hoisted + memoized. Takes
// `sortField` and `sortDirection` as props so it doesn't close over
// EventsClient state, keeping its reference stable across renders.
const SortIcon = React.memo(function SortIcon({
  field,
  sortField,
  sortDirection,
}: {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  if (sortField !== field) {
    return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40" />;
  }
  return sortDirection === "asc" ? (
    <ChevronUp className="h-3 w-3 ml-1" />
  ) : (
    <ChevronDown className="h-3 w-3 ml-1" />
  );
});

// ─── Row-level components: hoisted + memoized ─────────────────────────
// These were previously defined inside EventsClient. That created a
// fresh function reference on every render, which React treated as a
// new component type → every instance unmounted + remounted on every
// keystroke. With 907+ events rendering up to 900+ instances of these,
// the reconciliation churn was heavy enough to drop focus from
// sibling inputs (the "events search one letter then loses focus" bug
// originally reported v9 brief 2026-04-21).
//
// Hoisting makes the component reference stable. React.memo ensures
// rows whose props haven't changed skip re-rendering entirely during
// search typing — `event`, `weatherMap`, and `today` are all stable
// references across keystrokes, so rows render zero times per letter
// typed.

const WeatherBadge = React.memo(function WeatherBadge({
  event,
  weatherMap,
}: {
  event: Event;
  weatherMap: Map<string, WeatherForecast>;
}) {
  const wx = weatherMap.get(event.id);
  if (!wx) return null;
  const { icon, label } = getWeatherInfo(wx.wmoCode);
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-1"
      title={`${label} · ${wx.tempHigh}°/${wx.tempLow}°F`}
    >
      {icon}
      <span>{wx.tempHigh}°/{wx.tempLow}°</span>
    </span>
  );
});

// Shows a qualitative indicator when weather is meaningfully adjusting
// an upcoming event's forecast. Uses stored event_weather + known
// coefficients to infer direction and magnitude.
const WeatherForecastImpact = React.memo(function WeatherForecastImpact({
  event,
  today,
}: {
  event: Event;
  today: string;
}) {
  if (!event.event_weather || !event.forecast_sales || event.forecast_sales <= 0) return null;
  if (event.event_date < today) return null; // only for upcoming events
  // Suppress for fixed-revenue events (pre_settled, catering with
  // invoice, commission_with_minimum). Their revenue is contractually
  // locked, so a "weather is adjusting forecast by -$X" line is
  // misleading — there's nothing to adjust.
  if (isFixedRevenueEvent(event)) return null;

  const coeff = WEATHER_COEFFICIENTS[event.event_weather];
  if (coeff === undefined || coeff === null) return null;

  // Only show when there's a meaningful deviation (coeff differs from Clear=1.0 by >5%)
  const deviation = Math.abs(coeff - 1.0);
  if (deviation < 0.05) return null;

  // Base forecast without weather would be forecast_sales / coeff
  const baseForecast = event.forecast_sales / coeff;
  const dollarImpact = Math.round(event.forecast_sales - baseForecast);
  const absImpact = Math.abs(dollarImpact);

  // Only show when impact is meaningful: at least $50 AND at least 5% of the forecast
  if (absImpact < 50 || absImpact < event.forecast_sales * 0.05) return null;

  const isNegative = dollarImpact < 0;
  const sign = isNegative ? "-" : "+";
  const color = isNegative ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400";
  const arrow = isNegative ? "↓" : "↑";

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${color} ml-1`}
      title={`Weather (${event.event_weather}) adjusting forecast by ${sign}$${absImpact.toLocaleString()} — coefficient: ${coeff}`}
    >
      {arrow} {sign}${absImpact.toLocaleString()} weather
    </span>
  );
});

const ForecastVsActual = React.memo(function ForecastVsActual({
  event,
  today,
}: {
  event: Event;
  today: string;
}) {
  if (
    event.event_date >= today ||
    event.net_sales === null ||
    event.forecast_sales === null ||
    event.forecast_sales <= 0
  ) {
    return null;
  }
  // Fixed-revenue events (pre_settled, catering with invoice,
  // commission_with_minimum) carry a contracted amount that's the
  // ground truth for what was earned. The forecast engine still
  // produces a number against historical walk-up patterns, but
  // surfacing "Forecast: $510 / -100% variance" against a $750
  // contract is misleading — the contract amount already shows in
  // the actual + range columns. Suppress the variance line here.
  if (isFixedRevenueEvent(event)) return null;

  const actual = event.net_sales;
  // Prefer v2 point when stored — keeps the variance calculation
  // consistent with the forecast_card display upstream.
  const forecast =
    event.forecast_bayesian_point != null
      ? event.forecast_bayesian_point
      : event.forecast_sales;
  const diff = actual - forecast;
  const pct = forecast > 0 ? Math.round((diff / forecast) * 100) : 0;
  const isPositive = diff >= 0;

  // Range hit/miss classification — operator request 2026-05-06.
  // Dropped the redundant "Forecast: $X" prefix (Range column already
  // carries the prediction; double-display undermined the
  // de-precisification the range was designed to do). Replaced with
  // a within/below/above-range qualifier alongside the variance:
  //   - Within range  → green, "+$120 (+7%) · within range"
  //   - Below range   → red,   "-$694 (-40%) · below range"
  //   - Above range   → teal,  "+$340 (+19%) · above range"
  // Prefers v2's 80% credible interval when stored (more honestly
  // calibrated than v1's heuristic band). Falls back to v1 range
  // when v2 isn't populated, then to plain variance when neither is.
  const rangeLow =
    event.forecast_bayesian_low_80 != null
      ? event.forecast_bayesian_low_80
      : event.forecast_low;
  const rangeHigh =
    event.forecast_bayesian_high_80 != null
      ? event.forecast_bayesian_high_80
      : event.forecast_high;
  let rangeLabel: string | null = null;
  let rangeColor: string;
  const hasRange = rangeLow !== null && rangeHigh !== null;
  if (hasRange) {
    if (actual < rangeLow!) {
      rangeLabel = "below range";
      rangeColor = "text-red-600";
    } else if (actual > rangeHigh!) {
      rangeLabel = "above range";
      rangeColor = "text-brand-teal";
    } else {
      rangeLabel = "within range";
      rangeColor = "text-green-600";
    }
  } else {
    rangeColor = isPositive ? "text-green-600" : "text-red-600";
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className={`font-medium ${rangeColor}`}>
        {isPositive ? "+" : ""}{formatCurrency(diff)} ({isPositive ? "+" : ""}{pct}%)
      </span>
      {rangeLabel && (
        <span className={`text-xs ${rangeColor}`}>· {rangeLabel}</span>
      )}
    </div>
  );
});

interface TabCounts {
  all: number;
  upcoming: number;
  past: number;
  needs_attention: number;
}

// Bulk-edit field options. Server-side validation in
// /api/events/bulk-update mirrors these — keep them in sync. Values
// for each field are the same enum strings the rest of the app uses.
// Legacy "Private/Catering" event_type is intentionally absent (matches
// the new-event form's hidden behavior).
const BULK_FIELD_OPTIONS: Record<
  "event_type" | "event_mode" | "event_weather" | "event_size_tier_operator",
  { value: string; label: string }[]
> = {
  event_type: [
    { value: "Festival", label: "Festival" },
    { value: "Concert", label: "Concert" },
    { value: "Community/Neighborhood", label: "Community/Neighborhood" },
    { value: "Corporate", label: "Corporate" },
    { value: "Weekly Series", label: "Weekly Series" },
    { value: "Private", label: "Private" },
    { value: "Sports Event", label: "Sports Event" },
    { value: "Fundraiser/Charity", label: "Fundraiser/Charity" },
    { value: "Wedding", label: "Wedding" },
    { value: "Private Party", label: "Private Party" },
    { value: "Reception", label: "Reception" },
  ],
  event_mode: [
    { value: "food_truck", label: "Food truck" },
    { value: "catering", label: "Catering" },
  ],
  event_weather: [
    { value: "Clear", label: "Clear" },
    { value: "Overcast", label: "Overcast" },
    { value: "Hot", label: "Hot" },
    { value: "Cold", label: "Cold" },
    { value: "Rain Before Event", label: "Rain Before Event" },
    { value: "Rain During Event", label: "Rain During Event" },
    { value: "Storms", label: "Storms" },
    { value: "Snow", label: "Snow" },
  ],
  event_size_tier_operator: [
    { value: "SMALL", label: "Small" },
    { value: "NORMAL", label: "Normal" },
    { value: "LARGE", label: "Large" },
    { value: "FLAGSHIP", label: "Flagship" },
  ],
};

// Inline contact pill row for an event card / row. Mirrors the
// day-of card's button-styled actions (Call / Text / Email) so the
// affordance reads the same across both surfaces. Click handlers
// stopPropagation so the wrapping card/row's onClick (which opens
// the edit dialog) doesn't fire when the operator taps the action.
//
// Phone normalization: tel:/sms: hrefs strip non-digits because some
// operator-entered phone formats include spaces or dashes that
// confuse certain dialer apps.
function onlyContactDigits(s: string): string {
  return s.replace(/[^0-9+]/g, "");
}

function EventInlineContact({ contact }: { contact: Contact }) {
  const phone = contact.phone?.trim();
  const email = contact.email?.trim();
  if (!phone && !email) return null;
  return (
    <div
      className="mt-2 pt-2 border-t border-border/50"
      onClick={(e) => e.stopPropagation()}
    >
      {contact.name && (
        <p className="text-xs font-medium text-muted-foreground mb-1.5 truncate">
          {contact.name}
          {contact.organization && (
            <span className="font-normal"> · {contact.organization}</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {phone && (
          <>
            <a
              href={`tel:${onlyContactDigits(phone)}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 bg-primary/5 text-primary text-[11px] font-medium hover:bg-primary/10 hover:border-primary/50 transition-colors active:bg-primary/15"
              aria-label={`Call ${contact.name ?? "contact"}`}
            >
              <Phone className="h-3 w-3" />
              Call
            </a>
            <a
              href={`sms:${onlyContactDigits(phone)}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 bg-primary/5 text-primary text-[11px] font-medium hover:bg-primary/10 hover:border-primary/50 transition-colors active:bg-primary/15"
              aria-label={`Text ${contact.name ?? "contact"}`}
            >
              <MessageSquare className="h-3 w-3" />
              Text
            </a>
          </>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 bg-primary/5 text-primary text-[11px] font-medium hover:bg-primary/10 hover:border-primary/50 transition-colors active:bg-primary/15"
            aria-label={`Email ${contact.name ?? "contact"}`}
          >
            <Mail className="h-3 w-3" />
            Email
          </a>
        )}
      </div>
    </div>
  );
}

// Chip strip — renders below the tab nav. Categories visible per tab:
//   - Status (Booked / Unbooked / Cancelled): every tab
//   - Field (Missing type / weather / location / sales): Needs attention only
// Mutual-exclusivity within Status is enforced at toggle time in the
// chip module (toggleChip). Multiple field chips compose AND.
const ChipStrip = React.memo(function ChipStrip({
  activeTab,
  selectedChips,
  onToggle,
  onClear,
}: {
  activeTab: EventsTab;
  selectedChips: ReadonlySet<string>;
  onToggle: (chipId: string) => void;
  onClear: () => void;
}) {
  const visibleChips = CHIP_CATALOG.filter((c) => {
    if (c.category === "status") return true;
    if (c.category === "field") return activeTab === "needs_attention";
    return true;
  }).filter((c) => {
    // Hide the placeholder cancellation-reason chip — predicate is
    // structurally vacuous today (see chip module). Surface only when
    // the schema actually supports the case.
    return c.id !== "missing-cancellation-reason";
  });

  const hasAny = selectedChips.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-2 border-b">
      {visibleChips.map((c) => {
        const selected = selectedChips.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            data-testid={`chip-${c.id}`}
            data-selected={selected}
            className={
              selected
                ? "px-2.5 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground transition-colors"
                : "px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground transition-colors"
            }
          >
            {c.label}
          </button>
        );
      })}
      {hasAny && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 px-2 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          data-testid="chip-strip-clear"
        >
          Clear filters
        </button>
      )}
    </div>
  );
});

interface ListViewProps {
  // State
  activeTab: TabMode;
  setActiveTab: React.Dispatch<React.SetStateAction<TabMode>>;
  selectedChips: ReadonlySet<string>;
  handleChipToggle: (chipId: string) => void;
  handleClearChips: () => void;
  sortField: SortField;
  setSortField: React.Dispatch<React.SetStateAction<SortField>>;
  sortDirection: SortDirection;
  setSortDirection: React.Dispatch<React.SetStateAction<SortDirection>>;
  bookingId: string | null;
  setBookingId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingEvent: React.Dispatch<React.SetStateAction<Event | null>>;
  setSalesEvent: React.Dispatch<React.SetStateAction<Event | null>>;
  setDuplicatingEvent: React.Dispatch<React.SetStateAction<Event | null>>;
  // Derived / memoized collections
  initialEvents: Event[];
  tabCounts: TabCounts;
  /** Post-chip filtered counts for each tab. When a tab's filtered
   *  count is less than its total, the tab pill renders "(N of M)" so
   *  the operator notices that chip filters are hiding rows on that
   *  tab — even if they're currently looking at a different tab.
   *  Operator-surfaced 2026-05-06: previously we only hinted on the
   *  active tab, so switching away from a filtered tab silently lost
   *  the indicator. */
  tabFilteredCounts: TabCounts;
  filtered: Event[];
  sorted: Event[];
  weatherMap: Map<string, WeatherForecast>;
  today: string;
  // id → event_name lookup so cancelled+sold_out rows that carry a
  // caused_by_event_id can render "Carry-over from <name>" without
  // an extra fetch. Built in EventsClient.
  eventNameById: Map<string, string>;
  /** event_id → contact map for inline contact pill rendering. Built
   *  in the parent from the contacts prop so per-row render is O(1)
   *  without N+1 queries. Empty map when the operator has no contacts
   *  yet — components fall through to no-contact-row gracefully. */
  contactByEventId: Map<string, Contact>;
  // Handlers
  handleTabChange: (tab: TabMode) => void;
  handleSort: (field: SortField) => void;
  handleDuplicate: (event: Event) => void;
  handleDelete: (id: string) => void;
  handleQuickBook: (event: Event) => Promise<void>;
  handleDismiss: (eventId: string, reason: "disrupted" | "charity") => Promise<void>;
  // Table density toggle. Compact = glance (default); Advanced = full
  // analysis columns on Past+Booked. Owned by EventsClient + persisted
  // in localStorage so it survives reloads.
  tableDensity: "compact" | "advanced";
  handleTableDensity: (v: "compact" | "advanced") => void;
  // Event id to flash-highlight on render — used by the marketplace
  // inquiry inbox's "View event →" deep-link. Null when no highlight
  // is requested. The ring + bg-orange/10 fade on a setTimeout in
  // EventsClient.
  highlightedEventId: string | null;
  /** Hides Enter-sales / log-revenue CTAs for managers without
   *  Financials access. The dollar columns themselves are already
   *  null'd server-side, so the rest of the UI collapses naturally. */
  financialsVisible: boolean;
}

function ListView({
  activeTab,
  setActiveTab,
  selectedChips,
  handleChipToggle,
  handleClearChips,
  sortField,
  setSortField,
  sortDirection,
  setSortDirection,
  bookingId,
  setBookingId,
  setEditingEvent,
  setSalesEvent,
  setDuplicatingEvent,
  initialEvents,
  tabCounts,
  tabFilteredCounts,
  filtered,
  sorted,
  weatherMap,
  today,
  eventNameById,
  contactByEventId,
  handleTabChange,
  handleSort,
  handleDuplicate,
  handleDelete,
  handleQuickBook,
  handleDismiss,
  tableDensity,
  handleTableDensity,
  highlightedEventId,
  financialsVisible,
}: ListViewProps) {
  function carryOverLabel(event: Event): string | null {
    if (!event.caused_by_event_id) return null;
    const name = eventNameById.get(event.caused_by_event_id);
    return name ? `Carry-over from ${name}` : "Carry-over from earlier event";
  }
  // Analysis columns (Type / Fees out / Forecast / Profit) only on
  // Past + Booked AND when the operator has opted into the advanced
  // table density. Default density is "compact" — clean glance with
  // ForecastVsActual rendered inline under event names. Operators who
  // want all the numbers visible flip the density toggle in the
  // header. Cancelled/Unbooked status chips on the Past tab still
  // revert to glance because Fees / Profit are nonsensical for those.
  const showAnalysisColumns =
    tableDensity === "advanced" &&
    activeTab === "past" &&
    selectedChips.has("booked");

  // ── Bulk-edit state (Needs Attention tab only) ─────────────────────
  // Multi-select + bulk-apply for enum-typed fields. Scoped to Needs
  // Attention because that's where operators do batch cleanup; other
  // tabs aren't the right surface for "select 30 rows and apply." API
  // route validates the field allowlist + enum membership server-side.
  const bulkEnabled = activeTab === "needs_attention";
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(
    new Set()
  );
  const [bulkField, setBulkField] = useState<
    "event_type" | "event_mode" | "event_weather" | "event_size_tier_operator" | ""
  >("");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const router = useRouter();

  // Clear selection when leaving the Needs Attention tab or when the
  // filtered set shifts under us. Selecting a row only to have it
  // disappear from view is a paper cut — better to reset and let the
  // operator re-select intentionally.
  useEffect(() => {
    if (!bulkEnabled) {
      setBulkSelectedIds(new Set());
      setBulkField("");
      setBulkValue("");
      setBulkMessage(null);
    }
  }, [bulkEnabled]);

  // Prune selected ids that are no longer in the visible filtered set
  // — chip toggles can hide previously-selected rows.
  useEffect(() => {
    if (!bulkEnabled || bulkSelectedIds.size === 0) return;
    const visible = new Set(sorted.map((e) => e.id));
    let needsPrune = false;
    for (const id of bulkSelectedIds) {
      if (!visible.has(id)) {
        needsPrune = true;
        break;
      }
    }
    if (needsPrune) {
      setBulkSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) if (visible.has(id)) next.add(id);
        return next;
      });
    }
  }, [bulkEnabled, sorted, bulkSelectedIds]);

  function toggleBulkSelect(id: string) {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkMessage(null);
  }

  function bulkSelectAllVisible() {
    setBulkSelectedIds(new Set(sorted.map((e) => e.id)));
    setBulkMessage(null);
  }

  function bulkClearSelection() {
    setBulkSelectedIds(new Set());
    setBulkField("");
    setBulkValue("");
    setBulkMessage(null);
  }

  async function bulkApply() {
    if (!bulkField || !bulkValue || bulkSelectedIds.size === 0) return;
    setBulkApplying(true);
    setBulkMessage(null);
    try {
      const res = await fetch("/api/events/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(bulkSelectedIds),
          field: bulkField,
          value: bulkValue,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        updated?: number;
        requested?: number;
        error?: string;
      };
      if (!res.ok || !json.success) {
        setBulkMessage(json.error ?? "Update failed");
        setBulkApplying(false);
        return;
      }
      const n = json.updated ?? 0;
      const total = json.requested ?? bulkSelectedIds.size;
      setBulkMessage(
        n === total
          ? `Updated ${n} event${n === 1 ? "" : "s"}`
          : `Updated ${n} of ${total} (others outside your scope)`
      );
      setBulkSelectedIds(new Set());
      setBulkField("");
      setBulkValue("");
      router.refresh();
    } catch (err) {
      setBulkMessage(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBulkApplying(false);
    }
  }

  return (
    <>
      {/* 4-tab nav (chip-foundation refactor 2026-04-30):
          All / Upcoming / Past / Needs attention. Status filtering
          (booked/unbooked/cancelled) and field filtering moved to
          chips. Tab counts include all events in tab scope BEFORE
          chip refinement.
          Filter-visibility badge: when the active tab's chip-filtered
          count is less than its scope total, the active pill renders
          "(N of M)" instead of "(M)". Surfaces the case where chips
          are hiding rows the operator would otherwise expect to see —
          inactive tabs always show their scope total since their
          chip set isn't currently in play. */}
      <div className="flex gap-1 border-b overflow-x-auto">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "all"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => handleTabChange("all")}
        >
          All ({tabFilteredCounts.all < tabCounts.all
            ? `${tabFilteredCounts.all} of ${tabCounts.all}`
            : tabCounts.all})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "upcoming"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => handleTabChange("upcoming")}
        >
          Upcoming ({tabFilteredCounts.upcoming < tabCounts.upcoming
            ? `${tabFilteredCounts.upcoming} of ${tabCounts.upcoming}`
            : tabCounts.upcoming})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "past"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => handleTabChange("past")}
        >
          Past ({tabFilteredCounts.past < tabCounts.past
            ? `${tabFilteredCounts.past} of ${tabCounts.past}`
            : tabCounts.past})
        </button>
        {tabCounts.needs_attention > 0 && (
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === "needs_attention"
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-orange/80 hover:text-brand-orange"
            }`}
            onClick={() => handleTabChange("needs_attention")}
          >
            Needs attention
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[10px] font-bold text-white">
              {tabFilteredCounts.needs_attention < tabCounts.needs_attention
                ? `${tabFilteredCounts.needs_attention} of ${tabCounts.needs_attention}`
                : tabCounts.needs_attention}
            </span>
          </button>
        )}
      </div>

      {/* Chip strip — refines within the active tab. Status chips
          (Booked / Unbooked inquiry / Cancelled) on every tab; field
          chips (Missing event type / weather / location / sales) on
          Needs attention only. */}
      <ChipStrip
        activeTab={activeTab}
        selectedChips={selectedChips}
        onToggle={handleChipToggle}
        onClear={handleClearChips}
      />

      {/*
       * Filter bar (search + year + mode + delete all) was lifted out
       * of ListView as of 2026-04-24 — it now renders as a sibling at
       * the EventsClient level, right before <ListView />. Rationale:
       * ListView is a nested function component whose reference
       * changes every render, so React treats it as a new component
       * type and unmounts+remounts it per keystroke. When the search
       * <input> lived inside ListView, it was destroyed and recreated
       * with each keystroke → focus lost. As a sibling of ListView,
       * the filter bar stays mounted even when ListView churns.
       * Proper follow-up is to extract ListView entirely (557 lines,
       * ~30 closure refs) — this is the minimal fix that unblocks
       * usable search without that big refactor.
       */}

      {/* Events Table — Card's default overflow-hidden was clipping the
          inner table wrapper's horizontal scrollbar at viewports below
          xl, so columns past the visible width were unreachable. Allow
          x-axis overflow on this card; keep y-axis clipped so the
          rounded corners still mask any vertical bleed. */}
      <Card className="overflow-x-visible overflow-y-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {activeTab === "all"
              ? "All Events"
              : activeTab === "upcoming"
              ? "Upcoming Events"
              : activeTab === "past"
              ? "Past Events"
              : "Events Needing Attention"}
          </CardTitle>
          {/* Needs-attention explainer — surfaces why events land here
              and what the three row-actions mean. v1 of this tab keeps
              the original missing-sales messaging since that's the
              majority case; field chips above the table refine to
              specific gaps when the operator needs them. */}
          {activeTab === "needs_attention" && (
            <p className="text-sm text-muted-foreground mt-1">
              Events with at least one missing field (event type, weather, location, sales, or cancellation reason). Use the chips above to narrow.
              <span className="block mt-1.5 space-y-0.5">
                <span className="block">
                  <DollarSign className="h-3.5 w-3.5 inline-block mr-1 text-green-600 align-text-bottom" />
                  <strong>Enter sales</strong> — log what you actually made.
                </span>
                <span className="block">
                  <CloudLightning className="h-3.5 w-3.5 inline-block mr-1 text-amber-700 align-text-bottom" />
                  <strong>Disrupted</strong> — storm, breakdown, or no-show. Excluded from forecast math.
                </span>
                <span className="block">
                  <Heart className="h-3.5 w-3.5 inline-block mr-1 text-pink-700 align-text-bottom" />
                  <strong>Charity</strong> — donated event. Logs $0 intentionally, stays in forecast math.
                </span>
              </span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="h-32 flex flex-col items-center justify-center gap-3 text-muted-foreground" data-testid="events-empty-state">
              {initialEvents.length === 0 ? (
                <p>No events yet. Add your first event to get started.</p>
              ) : selectedChips.size > 0 ? (
                <>
                  <p>No events match these filters.</p>
                  <button
                    type="button"
                    onClick={handleClearChips}
                    className="text-sm text-primary hover:underline"
                    data-testid="events-empty-state-clear"
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <p>No events match your search.</p>
              )}
            </div>
          ) : (
            <>
            {/* Mobile card list — replaces the horizontally-scrolling table
                at <sm. Surfaces the essentials (date, name, location, sales,
                forecast) with one tap-to-edit target per card. Flagged-tab
                quick actions (Enter sales / Book it) render as pill buttons
                below the card body to stay touchable. */}
            <div className="sm:hidden space-y-2">
              {sorted.map((event) => {
                const isCatering = (event.event_mode ?? "food_truck") === "catering";
                // Fixed-revenue events (pre_settled, catering+invoice,
                // commission_with_minimum) carry the contract amount
                // outside net_sales — surface it here so the row's
                // headline number reflects revenue, not just walk-up.
                // Walk-up sales (event.net_sales) add on top.
                const isFixed = isFixedRevenueEvent(event);
                const displaySales = isFixed
                  ? fixedRevenueAmount(event) + (event.net_sales ?? 0)
                  : isCatering && (event.invoice_revenue ?? 0) > 0
                    ? (event.net_sales ?? 0) + (event.invoice_revenue ?? 0)
                    : event.net_sales;
                const needsSales = financialsVisible && event.event_date <= today && !event.net_sales && !event.cancellation_reason && !(isCatering && (event.invoice_revenue ?? 0) > 0);
                const isUnbookedFuture = !event.booked && event.event_date >= today && !event.cancellation_reason;
                const isBulkSelected = bulkSelectedIds.has(event.id);
                return (
                  <div key={event.id} className="relative">
                    {bulkEnabled && (
                      <div
                        className="absolute left-2 top-3 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isBulkSelected}
                          onCheckedChange={() => toggleBulkSelect(event.id)}
                          aria-label={`Select ${event.event_name}`}
                        />
                      </div>
                    )}
                  <button
                    type="button"
                    onClick={() => setEditingEvent(event)}
                    className={`w-full text-left rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors ${
                      bulkEnabled ? "pl-10" : ""
                    } ${
                      isBulkSelected ? "ring-2 ring-primary" : ""
                    } ${
                      isCatering ? "border-l-[3px] border-l-brand-teal" :
                      activeTab === "all" && event.booked ? "border-l-[3px] border-l-green-500" :
                      activeTab === "all" && !event.booked ? "border-l-[3px] border-l-slate-300 dark:border-l-slate-600" :
                      ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                            {formatDate(event.event_date)}
                          </span>
                          {event.cancellation_reason && (
                            <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">
                              {event.cancellation_reason === "sold_out" && event.caused_by_event_id
                                ? "Sold out"
                                : "Cancelled"}
                            </Badge>
                          )}
                          {event.cancellation_reason === "sold_out" && event.caused_by_event_id && (
                            <span className="text-[10px] text-muted-foreground italic">
                              {carryOverLabel(event) ?? ""}
                            </span>
                          )}
                          {!event.booked && !event.cancellation_reason && (
                            <Badge variant="outline" className="text-[10px]">Unbooked</Badge>
                          )}
                          {event.event_date >= today && weatherMap.has(event.id) && <WeatherBadge event={event} weatherMap={weatherMap} />}
                        </div>
                        <div className="font-medium text-sm mt-1 truncate">{event.event_name}</div>
                        {(event.event_type || event.location || event.city) && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {[event.event_type, event.location ?? event.city].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        <ForecastVsActual event={event} today={today} />
                      </div>
                      <div className="text-right shrink-0">
                        {event.cancellation_reason === "sold_out" && event.caused_by_event_id ? (
                          // Linked carry-over — suppress the "$0" headline; the
                          // "Sold out · Carry-over from X" line above carries
                          // the meaning. Stats engine excludes this row from
                          // accuracy denominators (PR b).
                          <div className="text-sm font-medium text-muted-foreground">—</div>
                        ) : (
                          <div className="text-sm font-semibold tabular-nums">
                            {formatCurrency(displaySales)}
                            {isCatering && (event.invoice_revenue ?? 0) > 0 && (
                              <span className="text-[10px] text-brand-teal ml-1">inv</span>
                            )}
                          </div>
                        )}
                        {event.event_date >= today && event.forecast_sales && (
                          <div className="mt-1">
                            <ForecastInline event={event} />
                          </div>
                        )}
                      </div>
                    </div>
                    {(needsSales || isUnbookedFuture) && (
                      <div
                        className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isUnbookedFuture && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-11 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800"
                            disabled={bookingId === event.id}
                            onClick={() => handleQuickBook(event)}
                          >
                            <BookCheck className="h-3.5 w-3.5 mr-1.5" />
                            {bookingId === event.id ? "Booking..." : "Book it"}
                          </Button>
                        )}
                        {needsSales && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-11 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800"
                            onClick={() => setSalesEvent(event)}
                          >
                            <DollarSign className="h-3.5 w-3.5 mr-1.5" />
                            {isCatering ? "Log invoice" : "Log sales"}
                          </Button>
                        )}
                      </div>
                    )}
                    {/* Inline linked-contact pills — Call / Text / Email
                        for the contact associated with this event via
                        Contact.linked_event_ids. Click handlers
                        stopPropagation so they fire without opening
                        the edit dialog. */}
                    {contactByEventId.get(event.id) && (
                      <EventInlineContact
                        contact={contactByEventId.get(event.id)!}
                      />
                    )}
                  </button>
                  </div>
                );
              })}
            </div>

            {/* Density toggle — only meaningful on Past+Booked since
                that's where the analysis columns show up. Compact is
                the default; operators flip to Advanced when they want
                Type / Fees out / Forecast / Profit visible alongside
                Net Sales. Persisted in localStorage. */}
            {activeTab === "past" && selectedChips.has("booked") && (
              <div className="hidden sm:flex items-center justify-end gap-2 pb-2 text-xs text-muted-foreground">
                <span>Columns:</span>
                <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                  <button
                    type="button"
                    onClick={() => handleTableDensity("compact")}
                    className={
                      tableDensity === "compact"
                        ? "px-2 py-0.5 rounded bg-background text-foreground shadow-sm"
                        : "px-2 py-0.5 rounded hover:text-foreground"
                    }
                    aria-pressed={tableDensity === "compact"}
                    title="Glance — Date / Event / Net Sales / Forecast"
                  >
                    Compact
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTableDensity("advanced")}
                    className={
                      tableDensity === "advanced"
                        ? "px-2 py-0.5 rounded bg-background text-foreground shadow-sm"
                        : "px-2 py-0.5 rounded hover:text-foreground"
                    }
                    aria-pressed={tableDensity === "advanced"}
                    title="Full — adds Type / Fees out / Profit"
                  >
                    Advanced
                  </button>
                </div>
              </div>
            )}

            <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {bulkEnabled && (
                    <TableHead className="w-8 pr-0">
                      <Checkbox
                        checked={
                          sorted.length > 0 &&
                          bulkSelectedIds.size === sorted.length
                        }
                        onCheckedChange={(checked) => {
                          if (checked) bulkSelectAllVisible();
                          else bulkClearSelection();
                        }}
                        aria-label="Select all visible"
                      />
                    </TableHead>
                  )}
                  <TableHead
                    className="cursor-pointer select-none pr-6 whitespace-nowrap"
                    onClick={() => handleSort("event_date")}
                  >
                    <span className="inline-flex items-center">
                      Date
                      <SortIcon field="event_date" sortField={sortField} sortDirection={sortDirection} />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort("event_name")}
                  >
                    <span className="inline-flex items-center">
                      Event
                      <SortIcon field="event_name" sortField={sortField} sortDirection={sortDirection} />
                    </span>
                  </TableHead>
                  {/* Type — Past + Booked analysis view only.
                      showAnalysisColumns gates this; cancelled and
                      unbooked status chips revert to glance layout.
                      text-xs + tight padding keeps it inside the
                      781px card at 1100px viewport. */}
                  {showAnalysisColumns && (
                    <TableHead
                      className="cursor-pointer select-none px-2 text-xs"
                      onClick={() => handleSort("event_type")}
                    >
                      <span className="inline-flex items-center">
                        Type
                        <SortIcon field="event_type" sortField={sortField} sortDirection={sortDirection} />
                      </span>
                    </TableHead>
                  )}
                  <TableHead
                    className={
                      showAnalysisColumns
                        ? "cursor-pointer select-none text-right px-2 text-xs"
                        : "cursor-pointer select-none text-right"
                    }
                    onClick={() => handleSort("net_sales")}
                  >
                    <span className="inline-flex items-center justify-end">
                      Net Sales
                      <SortIcon field="net_sales" sortField={sortField} sortDirection={sortDirection} />
                    </span>
                  </TableHead>
                  {/* After Fees — Past + Booked only. */}
                  {showAnalysisColumns && (
                    <TableHead
                      className="cursor-pointer select-none text-right px-2 text-xs"
                      onClick={() => handleSort("net_after_fees")}
                    >
                      <span className="inline-flex items-center justify-end">
                        Fees out
                        <SortIcon field="net_after_fees" sortField={sortField} sortDirection={sortDirection} />
                      </span>
                    </TableHead>
                  )}
                  {/* Forecast column — visible in compact view (default)
                      and also in the advanced Past+Booked view per
                      operator request 2026-05-02. ForecastVsActual still
                      renders inline under the event name for past events;
                      this dedicated column gives operators a sortable
                      side-by-side with Net Sales when they want it. */}
                  <TableHead
                    className={
                      showAnalysisColumns
                        ? "cursor-pointer select-none text-right px-2 text-xs"
                        : "hidden lg:table-cell cursor-pointer select-none text-right"
                    }
                    onClick={() => handleSort("forecast_sales")}
                  >
                    <span className="inline-flex items-center justify-end">
                      Forecast
                      <SortIcon field="forecast_sales" sortField={sortField} sortDirection={sortDirection} />
                    </span>
                  </TableHead>
                  {/* Profit — Past + Booked only, em-dash when cost
                      data missing on the row. */}
                  {showAnalysisColumns && (
                    <TableHead
                      className="cursor-pointer select-none text-right px-2 text-xs"
                      onClick={() => handleSort("net_profit")}
                    >
                      <span className="inline-flex items-center justify-end">
                        Profit
                        <SortIcon field="net_profit" sortField={sortField} sortDirection={sortDirection} />
                      </span>
                    </TableHead>
                  )}
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((event) => {
                  const isBulkSelected = bulkSelectedIds.has(event.id);
                  return (
                  <TableRow
                    key={event.id}
                    data-event-id={event.id}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                      highlightedEventId === event.id
                        ? "ring-2 ring-brand-orange ring-inset bg-brand-orange/10 "
                        : ""
                    }${
                      isBulkSelected
                        ? "bg-primary/10 "
                        : ""
                    }${
                      (event.event_mode ?? "food_truck") === "catering"
                        ? "border-l-[3px] border-l-brand-teal bg-brand-teal/[0.04] "
                        : activeTab === "all"
                          ? event.booked
                            ? "border-l-[3px] border-l-green-500 bg-green-50/40 dark:bg-green-950/10"
                            : "border-l-[3px] border-l-border bg-muted/30"
                          : ""
                    }`}
                    onClick={() => setEditingEvent(event)}
                  >
                    {bulkEnabled && (
                      <TableCell
                        className="w-8 pr-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isBulkSelected}
                          onCheckedChange={() => toggleBulkSelect(event.id)}
                          aria-label={`Select ${event.event_name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap text-sm pr-6">
                      {formatDate(event.event_date)}
                      {event.cancellation_reason && (
                        <Badge variant="outline" className="ml-2 text-xs text-destructive border-destructive/40">
                          {event.cancellation_reason === "sold_out" && event.caused_by_event_id
                            ? "Sold out"
                            : "Cancelled"}
                        </Badge>
                      )}
                      {event.cancellation_reason === "sold_out" && event.caused_by_event_id && (
                        <span className="ml-2 text-xs text-muted-foreground italic">
                          {carryOverLabel(event) ?? ""}
                        </span>
                      )}
                      {!event.booked && !event.cancellation_reason && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Unbooked
                        </Badge>
                      )}
                      {/* Weather badge for upcoming events within 14 days */}
                      {event.event_date >= today && weatherMap.has(event.id) && (
                        <WeatherBadge event={event} weatherMap={weatherMap} />
                      )}
                    </TableCell>
                    <TableCell
                      className={
                        showAnalysisColumns
                          ? "font-medium align-top text-xs px-2"
                          : "font-medium align-top"
                      }
                    >
                      <div
                        className={
                          showAnalysisColumns
                            ? "truncate max-w-[20ch]"
                            : "truncate max-w-[28ch]"
                        }
                      >
                        {event.event_name}
                      </div>
                      {/* Location stacked under the event name — same
                          pattern the mobile card view uses. Keeps
                          location visible at every viewport without
                          adding a column. */}
                      {(event.location || event.city) && (
                        <div
                          className={
                            showAnalysisColumns
                              ? "text-[10px] font-normal text-muted-foreground truncate max-w-[20ch]"
                              : "text-xs font-normal text-muted-foreground truncate max-w-[28ch]"
                          }
                        >
                          {event.location ?? event.city}
                        </div>
                      )}
                      {/* Forecast vs Actual for past events */}
                      <ForecastVsActual event={event} today={today} />
                      {/* Inline linked-contact pills under the event
                          name in the desktop table. Same component as
                          mobile; stopPropagation in EventInlineContact
                          keeps the row's onClick (edit-dialog) from
                          firing when operator taps Call/Text/Email. */}
                      {contactByEventId.get(event.id) && (
                        <EventInlineContact
                          contact={contactByEventId.get(event.id)!}
                        />
                      )}
                    </TableCell>
                    {/* Type cell — Past + Booked analysis only. */}
                    {showAnalysisColumns && (
                      <TableCell className="text-xs text-muted-foreground px-2 truncate max-w-[14ch]">
                        {event.event_type ?? "—"}
                      </TableCell>
                    )}
                    <TableCell
                      className={
                        showAnalysisColumns
                          ? "text-right font-medium text-xs px-2"
                          : "text-right font-medium"
                      }
                    >
                      {event.cancellation_reason === "sold_out" && event.caused_by_event_id ? (
                        <span className="text-muted-foreground">—</span>
                      ) : event.event_mode === "catering" && (event.invoice_revenue ?? 0) > 0 ? (
                        <span title={`Invoice: ${formatCurrency(event.invoice_revenue)}\nOn-site: ${formatCurrency(event.net_sales)}`}>
                          {formatCurrency((event.net_sales ?? 0) + (event.invoice_revenue ?? 0))}
                          <span className="text-[10px] text-brand-teal ml-1">inv</span>
                        </span>
                      ) : event.fee_type === "pre_settled" && fixedRevenueAmount(event) > 0 ? (
                        // Pre-settled: contract amount IS the revenue.
                        // Surface it here so the column doesn't read as
                        // "no sales logged" when there's a signed contract
                        // for $X. Walk-up sales add on top.
                        <span title={`Contract: ${formatCurrency(fixedRevenueAmount(event))}\nWalk-up: ${formatCurrency(event.net_sales)}`}>
                          {formatCurrency(fixedRevenueAmount(event) + (event.net_sales ?? 0))}
                          <span className="text-[10px] text-brand-teal ml-1">contract</span>
                        </span>
                      ) : (
                        formatCurrency(event.net_sales)
                      )}
                    </TableCell>
                    {/* Fees out cell — Past + Booked only. */}
                    {showAnalysisColumns && (
                      <TableCell className="text-right text-xs px-2">
                        {formatCurrency(event.net_after_fees)}
                      </TableCell>
                    )}
                    {/* Forecast cell — always rendered now. In compact
                        view stays on the lg breakpoint; in advanced
                        Past+Booked uses analysis sizing alongside Fees /
                        Profit. ForecastVsActual still shows inline under
                        the event name in either mode. */}
                    <TableCell
                      className={
                        showAnalysisColumns
                          ? "text-right text-xs text-muted-foreground px-2"
                          : "hidden lg:table-cell text-right text-sm text-muted-foreground"
                      }
                    >
                      <ForecastInline event={event} />
                      {event.event_date >= today && (
                        <WeatherForecastImpact event={event} today={today} />
                      )}
                    </TableCell>
                    {/* Profit cell — Past + Booked only. */}
                    {showAnalysisColumns && (
                      <TableCell className="text-right text-xs font-medium px-2">
                        {(() => {
                          const hasCost = event.food_cost !== null || event.labor_cost !== null || event.other_costs !== null;
                          if (!hasCost) return <span className="text-muted-foreground">—</span>;
                          const rev = (event.net_sales ?? 0) + (event.event_mode === "catering" ? (event.invoice_revenue ?? 0) : 0);
                          const costs = (event.food_cost ?? 0) + (event.labor_cost ?? 0) + (event.other_costs ?? 0);
                          const p = rev - costs;
                          const margin = rev > 0 ? (p / rev) * 100 : 0;
                          return (
                            <span className={p >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600"} title={`Margin: ${margin.toFixed(1)}%`}>
                              {formatCurrency(p)}
                            </span>
                          );
                        })()}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        {/* Needs-attention rows that match the missing-sales
                            predicate get the dismiss/log-sales actions
                            (Enter sales / Disrupted / Charity). Other rows
                            in needs_attention (missing weather/location/type)
                            get standard actions; tab change doesn't gate. */}
                        {financialsVisible &&
                        activeTab === "needs_attention" &&
                        event.event_date < today &&
                        event.booked &&
                        !event.cancellation_reason &&
                        event.net_sales === null &&
                        !(event.event_mode === "catering" && event.invoice_revenue > 0) &&
                        event.anomaly_flag !== "disrupted" ? (
                          <>
                            {/* pre_settled events keep the Enter-sales
                                action — operators routinely append
                                walk-up / overflow sales on top of the
                                contract amount, so locking them out
                                here was over-strict. */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-600"
                              title="Enter sales"
                              onClick={() => setSalesEvent(event)}
                            >
                              <DollarSign className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-amber-700 hover:text-amber-900 hover:bg-amber-50"
                              title="Dismiss: storm, cancellation, or no-show (excluded from forecasts)"
                              onClick={() => handleDismiss(event.id, "disrupted")}
                            >
                              <CloudLightning className="h-3.5 w-3.5 mr-1" />
                              Disrupted
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-pink-700 hover:text-pink-900 hover:bg-pink-50"
                              title="Dismiss: charity or donated event (logs $0 intentionally)"
                              onClick={() => handleDismiss(event.id, "charity")}
                            >
                              <Heart className="h-3.5 w-3.5 mr-1" />
                              Charity
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Edit event"
                              onClick={() => setEditingEvent(event)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            {/* Unbooked events: show "Book It" button */}
                            {!event.booked && event.event_date >= today && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                                title="Mark as booked — moves to Upcoming"
                                disabled={bookingId === event.id}
                                onClick={() => handleQuickBook(event)}
                              >
                                <BookCheck className="h-3.5 w-3.5 mr-1" />
                                {bookingId === event.id ? "Booking..." : "Book It"}
                              </Button>
                            )}
                            {financialsVisible && event.event_date <= today && !event.net_sales && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-green-600"
                                title="Enter sales"
                                onClick={() => setSalesEvent(event)}
                              >
                                <DollarSign className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Edit event"
                              onClick={() => setEditingEvent(event)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Duplicate event"
                              onClick={() => handleDuplicate(event)}
                            >
                              <CopyPlus className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              title="Delete event"
                              onClick={() => handleDelete(event.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
            </>
          )}

          {/* Bulk-edit action bar — sticky bottom, only on Needs Attention tab
              with at least one row selected. Sized + spaced for both mobile
              and desktop. Pops in via a simple show/hide rather than a
              portal so it stays inside the Events card's scroll context. */}
          {bulkEnabled && bulkSelectedIds.size > 0 && (
            <div className="sticky bottom-0 -mx-6 -mb-6 px-4 sm:px-6 py-3 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-20">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {bulkSelectedIds.size} selected
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={bulkClearSelection}
                  className="text-xs h-7"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Select
                    value={bulkField}
                    onValueChange={(v) => {
                      setBulkField(v as typeof bulkField);
                      setBulkValue("");
                      setBulkMessage(null);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[170px] text-xs">
                      <SelectValue placeholder="Set field…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="event_type">Event type</SelectItem>
                      <SelectItem value="event_mode">Event mode</SelectItem>
                      <SelectItem value="event_weather">Weather</SelectItem>
                      <SelectItem value="event_size_tier_operator">
                        Size tier
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {bulkField && (
                    <Select
                      value={bulkValue}
                      onValueChange={(v) => setBulkValue(v ?? "")}
                    >
                      <SelectTrigger className="h-8 w-[180px] text-xs">
                        <SelectValue placeholder="Pick a value…" />
                      </SelectTrigger>
                      <SelectContent>
                        {BULK_FIELD_OPTIONS[bulkField].map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      !bulkField || !bulkValue || bulkApplying
                    }
                    onClick={bulkApply}
                    className="h-8"
                  >
                    {bulkApplying
                      ? "Applying…"
                      : `Apply to ${bulkSelectedIds.size}`}
                  </Button>
                </div>
              </div>
              {bulkMessage && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {bulkMessage}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function EventsClient({ initialEvents, userId = "", businessName = "", userCity = "", userState = "", canSeeFinancials: financialsVisible = true, contacts = [] }: EventsClientProps) {
  // Distinct state codes used by this operator's events — floats to
  // top of EventForm's state dropdown after the profile state.
  const recentStates = useMemo(() => {
    const seen = new Set<string>();
    for (const e of initialEvents) {
      if (e.state) seen.add(e.state);
    }
    return Array.from(seen);
  }, [initialEvents]);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [duplicatingEvent, setDuplicatingEvent] = useState<Event | null>(null);
  const [salesEvent, setSalesEvent] = useState<Event | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [modeFilter, setModeFilter] = useState<"all" | "food_truck" | "catering">("all");
  const [sortField, setSortField] = useState<SortField>("event_date");
  // Initial activeTab below defaults to "upcoming" — soonest-first (asc) is
  // the right default for upcoming/unbooked views. handleTabChange keeps
  // this in sync on click; the ?tab= useEffect below handles URL-driven
  // tab changes so both paths land on the right default.
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [deleting, setDeleting] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [activeTab, setActiveTab] = useState<TabMode>("upcoming");
  // Selected chip IDs. Initialized from URL on mount + ?tab= effect
  // below. Defaults per tab applied only when ?chips= is absent —
  // operator deep-links preserve their selected chips.
  const [selectedChips, setSelectedChips] = useState<Set<string>>(
    () => new Set(TAB_DEFAULT_CHIPS.upcoming)
  );
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // "booked" hides unbooked inquiries and cancelled events; "all" shows
  // everything. Default "booked" — the calendar is an operational surface for
  // scheduled work, not an inquiry triage view. Persisted in localStorage.
  const [calendarFilter, setCalendarFilter] = useState<"all" | "booked">("booked");
  // Table density toggle. "compact" = glance layout (Date / Event /
  // Net Sales / Forecast inline / Actions). "advanced" = expanded
  // analysis layout on Past+Booked (adds Type / Fees out / Forecast /
  // Profit). Default compact — reduces information overload for the
  // common case; advanced is opt-in for operators who want all the
  // numbers visible. Persisted in localStorage.
  const [tableDensity, setTableDensity] = useState<"compact" | "advanced">("compact");
  // Selected day on the mobile calendar grid; null = nothing expanded.
  // Reset when the visible month changes.
  const [calendarExpandedDay, setCalendarExpandedDay] = useState<number | null>(null);
  const [weatherMap, setWeatherMap] = useState<Map<string, WeatherForecast>>(new Map());
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const shareTextRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Memoized once per mount. Stable for the tab session; worst case a
  // user leaves the page open past midnight and some events don't
  // re-classify to "past" until next navigation — acceptable tradeoff
  // for not re-computing on every keystroke.
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Load view mode from localStorage (default: "split").
  // Force-fallback split → list at <sm: split needs desktop width to be
  // useful, and the split toggle button is hidden on mobile anyway.
  useEffect(() => {
    const saved = localStorage.getItem("events_view_mode");
    if (saved !== "calendar" && saved !== "list" && saved !== "split") return;
    const isNarrow = !window.matchMedia("(min-width: 640px)").matches;
    setViewMode(saved === "split" && isNarrow ? "list" : saved);
  }, []);

  // Load calendar filter from localStorage (default: "booked")
  useEffect(() => {
    const saved = localStorage.getItem("events_calendar_filter");
    if (saved === "all") setCalendarFilter("all");
  }, []);

  function handleCalendarFilter(v: "all" | "booked") {
    setCalendarFilter(v);
    localStorage.setItem("events_calendar_filter", v);
  }

  // Load table density from localStorage (default: "compact").
  useEffect(() => {
    const saved = localStorage.getItem("events_table_density");
    if (saved === "advanced") setTableDensity("advanced");
  }, []);

  function handleTableDensity(v: "compact" | "advanced") {
    setTableDensity(v);
    localStorage.setItem("events_table_density", v);
  }

  // Auto-open new event dialog if ?new=true
  useEffect(() => {
    if (searchParams.get("new") === "true") {
      setShowForm(true);
    }
  }, [searchParams]);

  // Highlight a specific event row when arrived via
  // ?highlight=<event_id>. Used by the marketplace inquiry inbox's
  // "View event →" link so the operator's eye lands on the just-
  // claimed event without scrolling. Highlight fades after 3s.
  //
  // Two-step deps: re-run if URL changes OR if the events list
  // re-populates (filter/refresh). Without the second dep, deep-
  // linking from a fresh tab can race the events fetch and find
  // nothing in the DOM.
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  useEffect(() => {
    const targetId = searchParams.get("highlight");
    if (!targetId || initialEvents.length === 0) return;
    setHighlightedEventId(targetId);
    const scrollTimer = setTimeout(() => {
      const el = document.querySelector(`[data-event-id="${targetId}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
    const clearTimer = setTimeout(() => setHighlightedEventId(null), 3000);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [searchParams, initialEvents]);

  // URL → state sync. Two paths:
  //   1. Modern: ?tab=<EventsTab>&chips=<comma list>
  //   2. Legacy: ?tab=<7-tabmode>, ?missing=<field> (pre-chip URLs)
  //
  // Modern URL: parse tab + chips directly. ?chips= absent means "use
  // tab's defaults" so a fresh /dashboard/events?tab=upcoming still
  // pre-selects Booked. ?chips= present (even empty) means "operator
  // explicitly cleared" — preserve as-is so the deep-link survives.
  //
  // Legacy URL: legacyUrlMapping returns the right tab + chips. We
  // do NOT auto-rewrite the URL on legacy reads to avoid history
  // churn — the next chip toggle will normalize it.
  //
  // Sort direction follows the tab default each time the tab actually
  // changes (handleTabChange writes the URL; this effect re-reads
  // and re-aligns sort).
  useEffect(() => {
    const rawTab = searchParams.get("tab");
    const rawChips = searchParams.get("chips");
    const rawMissing = searchParams.get("missing");

    let tab: EventsTab;
    let chips: Set<string>;

    if (rawChips !== null) {
      // Modern: ?chips= is the authoritative chip set.
      tab = isValidTab(rawTab) ? rawTab : "upcoming";
      chips = chipsFromParam(rawChips);
    } else if (isValidTab(rawTab) && rawMissing === null) {
      // Modern URL with no ?chips=, no legacy hint → apply tab defaults.
      tab = rawTab;
      chips = new Set(TAB_DEFAULT_CHIPS[tab]);
    } else {
      // Legacy URL — let the mapping resolve.
      const mapped = legacyUrlMapping(rawTab, rawMissing);
      if (mapped) {
        tab = mapped.tab;
        chips = mapped.chips;
      } else {
        // Nothing recognizable; default to upcoming.
        tab = "upcoming";
        chips = new Set(TAB_DEFAULT_CHIPS.upcoming);
      }
    }

    setActiveTab(tab);
    setSelectedChips(chips);
    setSortField("event_date");
    setSortDirection(
      tab === "past" || tab === "all" || tab === "needs_attention"
        ? "desc"
        : "asc"
    );
  }, [searchParams]);

  function handleViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("events_view_mode", mode);
  }

  // Upcoming events within 14 days that have a city
  const upcomingWith14DaysAndCity = useMemo(
    () =>
      initialEvents.filter((e) => {
        if (e.event_date < today) return false;
        const diffDays = Math.ceil(
          (new Date(e.event_date + "T00:00:00").getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );
        return diffDays <= 14 && !!(e.city || e.location);
      }),
    [initialEvents, today]
  );

  // Fetch weather for upcoming events within 14 days
  const fetchWeatherForEvents = useCallback(async () => {
    if (upcomingWith14DaysAndCity.length === 0) return;

    const newMap = new Map<string, WeatherForecast>(weatherMap);

    for (const event of upcomingWith14DaysAndCity) {
      if (newMap.has(event.id)) continue;

      const cityName = event.city ?? event.location;
      if (!cityName) continue;

      try {
        // Geocode the city — try each name candidate (handles Saint↔St
        // mismatch between operator input and Open-Meteo's index). For
        // each candidate, apply state hard-constraint + PPL preference,
        // pick highest population. Mirrors lib/weather.ts:geocodeCity.
        // See B-1 smoke test (Bellville IL → Texas weather) for the bug
        // this fixes on the render path.
        let best: { latitude: number; longitude: number } | null = null;
        for (const candidate of cityGeocodeCandidates(cityName)) {
          const geoRes = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=10&format=json`
          );
          if (!geoRes.ok) continue;
          const geoData = await geoRes.json();
          const allResults = geoData.results as
            | Array<{
                latitude: number;
                longitude: number;
                population?: number;
                admin1?: string;
                feature_code?: string;
                country_code?: string;
              }>
            | undefined;
          if (!allResults || allResults.length === 0) continue;
          // US-only filter (country_code=us URL param doesn't restrict
          // server-side; verified 2026-05-08).
          let candidates = allResults.filter((r) => r.country_code === "US");
          if (candidates.length === 0) continue;

          // HARD state constraint when a known US code is set on the event.
          // If the filter eliminates all candidates, try the next candidate
          // — never fall back to a cross-state match.
          if (event.state && event.state !== "OTHER") {
            const fullName = US_STATE_NAMES[event.state.toUpperCase()];
            if (fullName) {
              candidates = candidates.filter(
                (r) => r.admin1?.toLowerCase() === fullName.toLowerCase()
              );
              if (candidates.length === 0) continue;
            }
          }

          // Prefer populated-place (PPL*) feature codes over airports,
          // landmarks, etc. Falls back to state-matched candidates if no
          // PPL match (airport is still state-correct — better than skip).
          const pplMatches = candidates.filter((r) =>
            r.feature_code?.startsWith("PPL")
          );
          const ranked = pplMatches.length > 0 ? pplMatches : candidates;
          best = ranked.reduce((a, b) =>
            (b.population ?? 0) > (a.population ?? 0) ? b : a
          );
          break;
        }
        if (!best) continue;
        const { latitude, longitude } = best;

        // Fetch forecast
        const wxRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${event.event_date}&end_date=${event.event_date}&temperature_unit=fahrenheit`
        );
        if (!wxRes.ok) continue;
        const wxData = await wxRes.json();

        const daily = wxData.daily as {
          time: string[];
          weathercode: number[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
        } | undefined;

        if (!daily || !daily.time || daily.time.length === 0) continue;
        const idx = daily.time.indexOf(event.event_date);
        if (idx === -1) continue;

        newMap.set(event.id, {
          wmoCode: daily.weathercode[idx] ?? 0,
          tempHigh: Math.round(daily.temperature_2m_max[idx] ?? 70),
          tempLow: Math.round(daily.temperature_2m_min[idx] ?? 50),
        });
      } catch {
        // silently skip
      }
    }

    setWeatherMap(newMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingWith14DaysAndCity.map((e) => e.id).join(",")]);

  useEffect(() => {
    fetchWeatherForEvents();
  }, [fetchWeatherForEvents]);

  // ── Memoization strategy ──────────────────────────────────────────
  // Before this refactor: all the filter/sort operations below ran on
  // every render — including every keystroke in the search box. With
  // 907+ events the render was heavy enough to cause React concurrent-
  // rendering to drop input focus after the first keystroke, making
  // search unusable (v9 brief 2026-04-21).
  //
  // Each derived collection now memoizes against its actual inputs.
  // `search` only flows into `filtered` — every other memo is stable
  // across keystrokes, so typing now re-renders cheaply.

  const years = useMemo(
    () =>
      [
        ...new Set(
          initialEvents.map((e) =>
            new Date(e.event_date + "T00:00:00").getFullYear()
          )
        ),
      ].sort((a, b) => b - a),
    [initialEvents]
  );

  // id → event_name lookup so cancelled+sold_out rows that carry a
  // caused_by_event_id can render "carry-over from <name>" without an
  // extra fetch. Passed into ListView; the render-side helper lives there.
  const eventNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of initialEvents) m.set(e.id, e.event_name);
    return m;
  }, [initialEvents]);

  // event_id → contact map. Each event can have at most one displayed
  // contact (the first one that links to it, ordered by contact name).
  // Multi-contact events still show the first inline; "+N more" pattern
  // can come later — for now the operator already navigates to /contacts
  // for the full list. Built once per render rather than per-row to
  // avoid N×M lookup cost on large event lists.
  const contactByEventId = useMemo(() => {
    const m = new Map<string, Contact>();
    // Sort by name so the "primary" contact for a multi-contact event
    // is deterministic.
    const sorted = [...contacts].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "")
    );
    for (const c of sorted) {
      for (const eventId of c.linked_event_ids ?? []) {
        if (!m.has(eventId)) m.set(eventId, c);
      }
    }
    return m;
  }, [contacts]);

  // Split into all / upcoming (booked) / unbooked (future) / past / past_unbooked / flagged / cancelled.
  //
  // initialEvents arrives sorted desc by event_date from the server.
  // That's right for past-focused views (most recent first) but wrong
  // for upcoming-focused views, where the operator wants soonest at
  // the top (what's this week, next week, next month) rather than
  // the furthest-future date first. Re-sort upcoming + unbooked asc.
  // Booked future events, soonest-first. Used externally (calendar
  // share modal, dashboard nudges) — kept as a separate memo since
  // those consumers don't need chip filtering.
  const upcomingEvents = useMemo(
    () =>
      initialEvents
        .filter((e) => e.event_date >= today && e.booked && !e.cancellation_reason)
        .sort((a, b) => a.event_date.localeCompare(b.event_date)),
    [initialEvents, today]
  );

  // Tab-scoped: every event whose date / status matches the active
  // tab's hard scope, BEFORE chip refinement. Counts shown in the tab
  // bar are computed off these so operators see "what's there" not
  // "what's left after my filters."
  const tabScopedAll = useMemo(
    () => initialEvents.filter((e) => eventInTabScope(e, "all", today)),
    [initialEvents, today]
  );
  const tabScopedUpcoming = useMemo(
    () => initialEvents.filter((e) => eventInTabScope(e, "upcoming", today)),
    [initialEvents, today]
  );
  const tabScopedPast = useMemo(
    () => initialEvents.filter((e) => eventInTabScope(e, "past", today)),
    [initialEvents, today]
  );
  const tabScopedNeedsAttention = useMemo(
    () =>
      initialEvents.filter((e) =>
        eventInTabScope(e, "needs_attention", today)
      ),
    [initialEvents, today]
  );

  const tabCounts: TabCounts = useMemo(
    () => ({
      all: tabScopedAll.length,
      upcoming: tabScopedUpcoming.length,
      past: tabScopedPast.length,
      needs_attention: tabScopedNeedsAttention.length,
    }),
    [tabScopedAll, tabScopedUpcoming, tabScopedPast, tabScopedNeedsAttention]
  );

  // Post-chip counts for ALL tabs (not just the active one). Used by
  // tab pills to surface "(N of M)" when a filter is hiding rows on a
  // tab the operator isn't currently looking at. Cheap to compute —
  // applyChips runs the same predicate the active list uses, just
  // against each tab-scoped slice. Operator-surfaced 2026-05-06.
  const tabFilteredCounts: TabCounts = useMemo(
    () => ({
      all: applyChips(tabScopedAll, selectedChips, today).length,
      upcoming: applyChips(tabScopedUpcoming, selectedChips, today).length,
      past: applyChips(tabScopedPast, selectedChips, today).length,
      needs_attention: applyChips(tabScopedNeedsAttention, selectedChips, today).length,
    }),
    [tabScopedAll, tabScopedUpcoming, tabScopedPast, tabScopedNeedsAttention, selectedChips, today]
  );

  // The active list = tab-scoped events filtered through the chip
  // composition (status chips OR field chips, AND-composed).
  const activeEvents = useMemo(() => {
    const scoped =
      activeTab === "all"
        ? tabScopedAll
        : activeTab === "upcoming"
        ? tabScopedUpcoming
        : activeTab === "past"
        ? tabScopedPast
        : tabScopedNeedsAttention;
    return applyChips(scoped, selectedChips, today);
  }, [
    activeTab,
    selectedChips,
    today,
    tabScopedAll,
    tabScopedUpcoming,
    tabScopedPast,
    tabScopedNeedsAttention,
  ]);

  const filtered = useMemo(
    () =>
      activeEvents.filter((e) => {
        const matchesSearch = e.event_name
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesYear =
          yearFilter === "all" ||
          new Date(e.event_date + "T00:00:00").getFullYear().toString() === yearFilter;
        const matchesMode =
          modeFilter === "all" || (e.event_mode ?? "food_truck") === modeFilter;
        return matchesSearch && matchesYear && matchesMode;
      }),
    [activeEvents, search, yearFilter, modeFilter]
  );

  // Default sort direction by tab. Upcoming = soonest-first (asc);
  // everything else = most-recent-first (desc).
  const tabDefaultSort: SortDirection =
    activeTab === "past" || activeTab === "all" || activeTab === "needs_attention"
      ? "desc"
      : "asc";

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;

    switch (sortField) {
      case "event_date": {
        const da = new Date(a.event_date + "T00:00:00").getTime();
        const db = new Date(b.event_date + "T00:00:00").getTime();
        return (da - db) * dir;
      }
      case "event_name":
        return a.event_name.localeCompare(b.event_name) * dir;
      case "event_type": {
        const ta = a.event_type ?? "";
        const tb = b.event_type ?? "";
        return ta.localeCompare(tb) * dir;
      }
      case "event_tier": {
        const tierOrder: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };
        const oa = tierOrder[a.event_tier ?? ""] ?? 5;
        const ob = tierOrder[b.event_tier ?? ""] ?? 5;
        return (oa - ob) * dir;
      }
      case "location": {
        const la = a.location ?? a.city ?? "";
        const lb = b.location ?? b.city ?? "";
        return la.localeCompare(lb) * dir;
      }
      case "net_sales":
      case "net_after_fees":
      case "forecast_sales": {
        const va = a[sortField] ?? -Infinity;
        const vb = b[sortField] ?? -Infinity;
        return (va - vb) * dir;
      }
      case "net_profit": {
        const profitOf = (e: Event) => {
          const hasCost = e.food_cost !== null || e.labor_cost !== null || e.other_costs !== null;
          if (!hasCost) return -Infinity;
          const rev = (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
          return rev - (e.food_cost ?? 0) - (e.labor_cost ?? 0) - (e.other_costs ?? 0);
        };
        return (profitOf(a) - profitOf(b)) * dir;
      }
      default:
        return 0;
    }
  });

  // Build a ?tab=...&chips=... URL. Empty chips → omit the param.
  function buildEventsUrl(tab: EventsTab, chips: ReadonlySet<string>): string {
    const params = new URLSearchParams();
    params.set("tab", tab);
    const chipsParam = chipsToParam(chips);
    if (chipsParam.length > 0) params.set("chips", chipsParam);
    return `/dashboard/events?${params.toString()}`;
  }

  // Locked rule from the chip composition spec: "Don't auto-clear
  // chips on tab switch." But we DO apply per-tab defaults when the
  // operator clicks a tab they don't have explicit chips for.
  // Heuristic: if the current chip set matches the OLD tab's defaults,
  // treat it as "operator hasn't customized" and apply the new tab's
  // defaults. Otherwise preserve.
  function handleTabChange(tab: TabMode) {
    setActiveTab(tab);
    setSortField("event_date");
    setSortDirection(
      tab === "past" || tab === "all" || tab === "needs_attention"
        ? "desc"
        : "asc"
    );
    const oldDefaults = TAB_DEFAULT_CHIPS[activeTab];
    const matchesOldDefault =
      selectedChips.size === oldDefaults.length &&
      oldDefaults.every((c) => selectedChips.has(c));
    const nextChips: Set<string> = matchesOldDefault
      ? new Set(TAB_DEFAULT_CHIPS[tab])
      : new Set(selectedChips);
    setSelectedChips(nextChips);
    router.replace(buildEventsUrl(tab, nextChips));
  }

  function handleChipToggle(chipId: string) {
    setSelectedChips((prev) => {
      const next = toggleChip(prev, chipId);
      router.replace(buildEventsUrl(activeTab, next));
      return next;
    });
  }

  function handleClearChips() {
    const next = new Set<string>();
    setSelectedChips(next);
    router.replace(buildEventsUrl(activeTab, next));
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      if (field === "event_date") {
        setSortDirection(tabDefaultSort);
      } else {
        setSortDirection("asc");
      }
    }
  }

  async function handleCreate(data: EventFormData) {
    // Multi-day branch — when the form set multi_day_dates (i.e., the
    // "Multi-Day Event" toggle was on with a valid end date), call the
    // bulk-insert action so the server loops one INSERT per date. Each
    // row gets a unique event_date but shares every other field.
    if (data.multi_day_dates && data.multi_day_dates.length > 1) {
      await createMultiDayEvents(data, data.multi_day_dates);
    } else {
      await createEvent(data);
    }
    router.refresh();
  }

  async function handleUpdate(data: EventFormData) {
    if (!editingEvent) return;
    await updateEvent(editingEvent.id, data);
    setEditingEvent(null);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this event?")) return;
    await deleteEvent(id);
    router.refresh();
  }

  async function handleDeleteAll() {
    const count = initialEvents.length;
    if (
      !confirm(
        `Are you sure you want to delete ALL ${count} events? This cannot be undone.`
      )
    )
      return;
    if (
      !confirm(
        `Really delete all ${count} events? Type OK in the next prompt to confirm.`
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteAllEvents();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete events");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSalesEntry(
    eventId: string,
    netSales: number,
    invoiceRevenue: number,
    weather?: string,
    costs?: { food_cost?: number; labor_cost?: number; other_costs?: number }
  ) {
    const updateData: Partial<EventFormData> = {
      net_sales: netSales,
      invoice_revenue: invoiceRevenue,
    };
    if (weather) updateData.event_weather = weather;
    if (costs) {
      if (costs.food_cost !== undefined) updateData.food_cost = costs.food_cost;
      if (costs.labor_cost !== undefined) updateData.labor_cost = costs.labor_cost;
      if (costs.other_costs !== undefined) updateData.other_costs = costs.other_costs;
    }
    await updateEvent(eventId, updateData);
    router.refresh();
  }

  async function handleQuickBook(event: Event) {
    setBookingId(event.id);
    try {
      await updateEvent(event.id, { booked: true });
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to book event");
    } finally {
      setBookingId(null);
    }
  }

  async function handleDismiss(eventId: string, reason: "disrupted" | "charity") {
    try {
      await dismissFlaggedEvent(eventId, reason);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to dismiss event");
    }
  }

  function handleDuplicate(event: Event) {
    // Carry over event_name, location, time, type, etc. — everything
    // that identifies the venue/booking shape. Clear everything that's
    // outcome-specific to the source event so the duplicate is a
    // genuine new booking, not a ghost of the original.
    const template: Event = {
      ...event,
      id: "duplicate", // placeholder; EventForm ignores this on create
      event_date: "",
      // Financials — per-event outcomes never carry forward.
      net_sales: null,
      invoice_revenue: 0,
      net_after_fees: null,
      food_cost: null,
      labor_cost: null,
      other_costs: null,
      // Forecast columns — engine regenerates on save.
      forecast_sales: null,
      forecast_low: null,
      forecast_high: null,
      forecast_confidence: null,
      forecast_bayesian_point: null,
      forecast_bayesian_low_80: null,
      forecast_bayesian_high_80: null,
      forecast_bayesian_low_50: null,
      forecast_bayesian_high_50: null,
      forecast_bayesian_n_obs: null,
      forecast_bayesian_prior_src: null,
      forecast_bayesian_insufficient: null,
      forecast_bayesian_computed_at: null,
      // Don't carry forward a cancellation. Operator is duplicating
      // because the venue+shape is reusable; the new occurrence is a
      // fresh booking that isn't pre-cancelled.
      cancellation_reason: null,
      caused_by_event_id: null,
      anomaly_flag: "normal",
      // Per-event narrative — operator-specific to the source row.
      in_service_notes: [],
      content_capture_notes: null,
      after_event_summary: null,
      // POS source — the duplicate is operator-entered, not POS-synced
      // (even if the source was). Otherwise the duplicate appears in
      // POS-sync analytics as if it came from Toast/Square.
      pos_source: "manual",
      // Note: events.source_inquiry_id (from PR #134) carries forward
      // via spread. Not cleared here because the column is absent from
      // the Event type. If type regen surfaces it, add to the clear
      // list — duplicate shouldn't be tied to the source's inquiry.
    };
    setDuplicatingEvent(template);
  }

  async function handleRefreshForecasts() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/recalculate", { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { forecastsUpdated?: number };
        setRefreshMsg(`Updated ${data.forecastsUpdated ?? 0} forecast${data.forecastsUpdated === 1 ? "" : "s"}`);
        router.refresh();
      } else {
        setRefreshMsg("Failed — try again");
      }
    } catch {
      setRefreshMsg("Failed — try again");
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 4000);
    }
  }

  function exportCSV() {
    const headers = [
      "Event Name", "Date", "Mode", "Type", "Tier", "Location", "City",
      "Booked", "Cancelled", "Cancellation Reason", "Net Sales", "Invoice Revenue", "After Fees", "Forecast",
      "Food Cost", "Labor Cost", "Other Costs", "Net Profit",
      "Fee Type", "Fee Rate", "Sales Minimum", "Weather", "Anomaly", "Notes",
    ];
    const rows = initialEvents.map((e) => {
      const totalRevenue = (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
      const totalCosts = (e.food_cost ?? 0) + (e.labor_cost ?? 0) + (e.other_costs ?? 0);
      const hasAnyCost = e.food_cost !== null || e.labor_cost !== null || e.other_costs !== null;
      const netProfit = hasAnyCost ? (e.net_after_fees ?? totalRevenue) - totalCosts : "";
      return [
        e.event_name,
        e.event_date,
        e.event_mode === "catering" ? "Catering" : "Vending",
        e.event_type ?? "",
        e.event_tier ?? "",
        e.location ?? "",
        e.city ?? "",
        e.booked ? "Yes" : "No",
        e.cancellation_reason ? "Yes" : "No",
        e.cancellation_reason ?? "",
        e.net_sales ?? "",
        e.invoice_revenue > 0 ? e.invoice_revenue : "",
        e.net_after_fees ?? "",
        e.forecast_sales ?? "",
        e.food_cost ?? "",
        e.labor_cost ?? "",
        e.other_costs ?? "",
        netProfit,
        e.fee_type ?? "",
        e.fee_rate ?? "",
        e.sales_minimum ?? "",
        e.event_weather ?? "",
        e.anomaly_flag ?? "",
        e.notes ?? "",
      ];
    });

    // csvSafeDocument handles formula-injection prefix + RFC 4180
    // double-quote escape on every cell. Previously we only escaped
    // notes — other text fields containing `"` would silently produce
    // malformed CSV. Worse, an attacker-planted Toast/Square value
    // starting with `=`/`+`/`-`/`@` would execute as a formula when
    // the operator opens their own export in Excel/Sheets.
    const csv = csvSafeDocument([headers, ...rows]);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendcast-events-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Build social share text
  function buildShareText(): string {
    const name = businessName || "Our business";
    const city = userCity || "";
    const cityTag = city ? `#${city.replace(/\s+/g, "")}FoodTruck` : "#FoodTruck";
    const scheduleUrl = userId ? `vendcast.co/schedule/${userId}` : "vendcast.co";

    const soonestBooked = [...upcomingEvents]
      .sort((a, b) => new Date(a.event_date + "T00:00:00").getTime() - new Date(b.event_date + "T00:00:00").getTime())
      .slice(0, 5);

    const lines = soonestBooked.map((e) => {
      const d = new Date(e.event_date + "T00:00:00");
      const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const loc = e.location ?? e.city ?? "TBD";
      return `📅 ${e.event_name} — ${label} at ${loc}`;
    });

    const eventBlock = lines.length > 0 ? lines.join("\n") : "📅 More events coming soon!";

    return `🚚 ${name} is hitting these events soon!\n\n${eventBlock}\n\nFollow our schedule at: ${scheduleUrl}\n#FoodTruck ${cityTag} #StreetFood`;
  }

  async function handleCopyShare() {
    const text = buildShareText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback: select textarea
      if (shareTextRef.current) {
        shareTextRef.current.select();
        document.execCommand("copy");
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ---- CALENDAR GRID (shared between Calendar view and Split view) ----
  function CalendarGrid() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Build a grid of 6 rows x 7 cols
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const monthLabel = calendarMonth.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });

    // Events indexed by day, filtered by the "All events / Booked only" toggle.
    // Booked view hides unbooked inquiries and cancelled events so the calendar
    // becomes an at-a-glance view of confirmed commitments.
    const eventsByDay = new Map<number, Event[]>();
    for (const event of initialEvents) {
      if (calendarFilter === "booked") {
        if (!event.booked || event.cancellation_reason) continue;
      }
      const d = new Date(event.event_date + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!eventsByDay.has(day)) eventsByDay.set(day, []);
        eventsByDay.get(day)!.push(event);
      }
    }

    const todayDate = new Date();
    const isCurrentMonth =
      todayDate.getFullYear() === year && todayDate.getMonth() === month;
    const todayDay = isCurrentMonth ? todayDate.getDate() : -1;

    // Build map: day -> event id (for weather lookup)
    // We need to check if any event for that day is in the weatherMap
    function getWeatherForDay(day: number): WeatherForecast | null {
      const dayEvents = eventsByDay.get(day) ?? [];
      for (const event of dayEvents) {
        if (weatherMap.has(event.id)) {
          return weatherMap.get(event.id)!;
        }
      }
      return null;
    }

    function isDayInFuture14(day: number): boolean {
      const cellDate = new Date(year, month, day);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const diffMs = cellDate.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 14;
    }

    function prevMonth() {
      setCalendarMonth(new Date(year, month - 1, 1));
      setCalendarExpandedDay(null);
    }
    function nextMonth() {
      setCalendarMonth(new Date(year, month + 1, 1));
      setCalendarExpandedDay(null);
    }

    // Events to show in the expanded-day section at mobile
    const expandedDayEvents = calendarExpandedDay !== null
      ? eventsByDay.get(calendarExpandedDay) ?? []
      : [];

    return (
      <div className="space-y-4">
        {/* Month navigation + filter toggle */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">{monthLabel}</h2>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="inline-flex rounded-lg border bg-muted p-0.5 text-xs font-medium ml-auto">
            <button
              type="button"
              onClick={() => handleCalendarFilter("all")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                calendarFilter === "all"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All events
            </button>
            <button
              type="button"
              onClick={() => handleCalendarFilter("booked")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                calendarFilter === "booked"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Booked only
            </button>
          </div>
        </div>

        {/* Mobile grid view (< sm) — real 7-col month grid, tap a day to
            expand that day's events below. Keeps the spatial week-layout
            mental model operators are used to. */}
        <div className="sm:hidden space-y-3">
          <div>
            {/* Day headers */}
            <div className="grid grid-cols-7 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground pb-1.5">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={`m-head-${i}`}>{d}</div>
              ))}
            </div>
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, idx) => {
                if (day === null) {
                  return <div key={`m-empty-${idx}`} className="aspect-square" />;
                }
                const dayEvents = eventsByDay.get(day) ?? [];
                const isToday = day === todayDay;
                const isExpanded = calendarExpandedDay === day;
                const hasEvents = dayEvents.length > 0;
                const hasCatering = dayEvents.some((e) => (e.event_mode ?? "food_truck") === "catering");
                return (
                  <button
                    key={`m-day-${day}`}
                    type="button"
                    onClick={() => setCalendarExpandedDay(isExpanded ? null : day)}
                    className={`aspect-square rounded-md border text-xs font-medium flex flex-col items-center justify-center gap-0.5 transition-colors ${
                      isExpanded
                        ? "bg-primary/10 border-primary ring-1 ring-primary"
                        : hasEvents
                          ? "bg-card border-border hover:bg-muted"
                          : "bg-muted/30 border-transparent text-muted-foreground"
                    }`}
                    aria-label={`${day}${hasEvents ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ", no events"}`}
                  >
                    <span
                      className={`leading-none ${
                        isToday
                          ? "bg-primary text-primary-foreground rounded-full h-5 w-5 inline-flex items-center justify-center text-[11px]"
                          : ""
                      }`}
                    >
                      {day}
                    </span>
                    {hasEvents && (
                      <div className="flex items-center gap-0.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${hasCatering ? "bg-brand-teal" : "bg-primary"}`}
                        />
                        {dayEvents.length > 1 && (
                          <span className="text-[9px] font-semibold text-muted-foreground leading-none">
                            {dayEvents.length}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expanded day detail */}
          {calendarExpandedDay !== null && (
            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">
                  {new Date(year, month, calendarExpandedDay).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => setCalendarExpandedDay(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
              {expandedDayEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events on this day.</p>
              ) : (
                <div className="space-y-1.5">
                  {expandedDayEvents.map((event) => {
                    const isCatering = (event.event_mode ?? "food_truck") === "catering";
                    const startDisplay = formatTimeHHMM(event.start_time);
                    const endDisplay = formatTimeHHMM(event.end_time);
                    const timeRange = startDisplay && endDisplay
                      ? `${startDisplay} – ${endDisplay}`
                      : startDisplay ?? endDisplay ?? null;
                    return (
                      <button
                        key={event.id}
                        onClick={() => setEditingEvent(event)}
                        className={`flex items-start gap-2 w-full text-left rounded-md border bg-background px-3 py-2 hover:bg-muted transition-colors ${
                          isCatering ? "border-l-[3px] border-l-brand-teal" : ""
                        } ${event.cancellation_reason ? "opacity-70" : ""}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${event.cancellation_reason ? "line-through" : ""}`}>
                            {event.event_name}
                          </div>
                          {timeRange && (
                            <div className="text-xs text-muted-foreground">{timeRange}</div>
                          )}
                          {(event.event_type || event.location || event.city) && (
                            <div className="text-xs text-muted-foreground truncate">
                              {[event.event_type, event.location ?? event.city].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        {!event.booked && !event.cancellation_reason && (
                          <Badge variant="outline" className="text-[10px] shrink-0">Unbooked</Badge>
                        )}
                        {event.cancellation_reason && (
                          <Badge variant="outline" className="text-[10px] shrink-0 text-destructive border-destructive/40">Cancelled</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop grid view (>= sm) */}
        <div className="hidden sm:block space-y-2">
          {/* Day headers */}
          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground border-b pb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="bg-muted/30 min-h-20 p-1" />;
              }
              const dayEvents = eventsByDay.get(day) ?? [];
              const isToday = day === todayDay;
              const showWeather = isDayInFuture14(day) && dayEvents.length > 0;
              const wx = showWeather ? getWeatherForDay(day) : null;

              return (
                <div
                  key={`day-${day}`}
                  className="bg-card min-h-20 p-1.5 flex flex-col gap-1 relative"
                >
                  {/* Day number */}
                  <span
                    className={`text-xs font-medium self-start leading-none ${
                      isToday
                        ? "bg-primary text-primary-foreground rounded-full px-1.5 py-0.5"
                        : "text-muted-foreground"
                    }`}
                  >
                    {day}
                  </span>

                  {/* Weather in top-right corner */}
                  {wx && (
                    <div className="absolute top-1 right-1 flex items-center gap-0.5">
                      {getWeatherIconSmall(wx.wmoCode)}
                      <span className="text-[9px] text-muted-foreground font-medium leading-none">
                        {wx.tempHigh}°
                      </span>
                    </div>
                  )}

                  {dayEvents.slice(0, 3).map((event) => {
                    const cateringBorderClass = (event.event_mode ?? "food_truck") === "catering"
                      ? "border-l-2 border-l-brand-teal"
                      : "border-l-2 border-l-transparent";
                    const statusClasses = calendarEventClasses(event);
                    const startDisplay = formatTimeHHMM(event.start_time);
                    const endDisplay = formatTimeHHMM(event.end_time);
                    const timeRange = startDisplay && endDisplay
                      ? `${startDisplay} – ${endDisplay}`
                      : startDisplay ?? endDisplay ?? null;
                    const locationStr = [event.location, event.city].filter(Boolean).join(" · ");
                    const statusLabel = event.cancellation_reason
                      ? "Cancelled"
                      : !event.booked
                        ? "Unbooked"
                        : "Booked";
                    return (
                      <Tooltip key={event.id}>
                        <TooltipTrigger
                          render={
                            <button
                              onClick={() => setEditingEvent(event)}
                              className={`text-left text-[10px] font-medium px-1 py-0.5 rounded border w-full leading-tight ${statusClasses} ${cateringBorderClass} hover:opacity-80 transition-opacity`}
                            />
                          }
                        >
                          <div className="truncate">{event.event_name}</div>
                          {startDisplay && (
                            <div className="text-[9px] opacity-75 truncate font-normal">
                              {startDisplay}
                            </div>
                          )}
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="max-w-[260px] space-y-0.5">
                            <div className="font-semibold">{event.event_name}</div>
                            <div className="text-xs opacity-90">{statusLabel}</div>
                            {timeRange && (
                              <div className="text-xs opacity-90">{timeRange}</div>
                            )}
                            {locationStr && (
                              <div className="text-xs opacity-90">{locationStr}</div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] text-muted-foreground pl-1">
                      +{dayEvents.length - 3} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---- UPCOMING LIST PANEL (used in Split view right panel) ----
  function UpcomingListPanel() {
    const sortedUpcoming = [...upcomingEvents].sort(
      (a, b) => new Date(a.event_date + "T00:00:00").getTime() - new Date(b.event_date + "T00:00:00").getTime()
    );

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Upcoming Events</h3>
          <span className="text-xs text-muted-foreground ml-auto">{sortedUpcoming.length} booked</span>
        </div>
        {sortedUpcoming.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            No upcoming booked events.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {sortedUpcoming.map((event) => {
              const wx = weatherMap.get(event.id);
              return (
                <div
                  key={event.id}
                  className="border rounded-lg p-3 bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{event.event_name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(event.event_date)}
                      </p>
                      {(event.location || event.city) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {event.location ?? event.city}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {wx && (
                        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          {getWeatherIconSmall(wx.wmoCode)}
                          <span>{wx.tempHigh}°</span>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditingEvent(event)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {event.forecast_sales && !isFixedRevenueEvent(event) && (
                    <div className="mt-1 flex items-center flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>Forecast:</span>
                      <ForecastInline event={event} />
                      <WeatherForecastImpact event={event} today={today} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- CALENDAR VIEW ----
  function CalendarView() {
    return (
      <div className="space-y-4">
        <CalendarGrid />
      </div>
    );
  }

  // ---- LIST VIEW ----

  const shareText = buildShareText();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-muted-foreground">
            {initialEvents.length} total events
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Refresh Forecasts button */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleRefreshForecasts}
              disabled={refreshing}
              title="Recalculate all forecasts and backfill any missing ones"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh Forecasts"}</span>
            </Button>
            {refreshMsg && (
              <span className="text-xs text-muted-foreground">{refreshMsg}</span>
            )}
          </div>

          {/* Export CSV button */}
          {initialEvents.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={exportCSV}
              title="Export all events as CSV"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}

          {/* Share button */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setShowShareModal(true)}
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share Schedule</span>
          </Button>

          {/* View toggle: List | Split | Calendar */}
          <div className="flex border rounded-md overflow-hidden">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="rounded-none border-0 px-3"
              onClick={() => handleViewMode("list")}
              title="List view"
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            {/* Split view is desktop-only — neither half gets enough space at <sm */}
            <Button
              variant={viewMode === "split" ? "default" : "ghost"}
              size="sm"
              className="hidden sm:inline-flex rounded-none border-0 px-3"
              onClick={() => handleViewMode("split")}
              title="Split view"
            >
              <Columns2 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "calendar" ? "default" : "ghost"}
              size="sm"
              className="rounded-none border-0 px-3"
              onClick={() => handleViewMode("calendar")}
              title="Calendar view"
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>

          <Button className="gap-2" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </div>
      </div>

      <DataImportTrigger hasEvents={initialEvents.length > 0} />

      {viewMode === "calendar" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Calendar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CalendarView />
          </CardContent>
        </Card>
      ) : viewMode === "split" ? (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Left: Calendar (~55%) */}
          <div className="lg:w-[55%] min-w-0">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4" />
                  Calendar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CalendarGrid />
              </CardContent>
            </Card>
          </div>
          {/* Right: Upcoming list (~45%) */}
          <div className="lg:w-[45%] min-w-0">
            <Card className="h-full">
              <CardContent className="pt-4 h-full" style={{ minHeight: "400px" }}>
                <UpcomingListPanel />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <>
          {/*
           * Filter bar — lifted OUT of ListView so the search <input>
           * survives ListView's per-render remount (see long comment
           * inside ListView for the full explanation). Tabs still live
           * inside ListView since they don't host text inputs.
           */}
          {/* (chip-foundation refactor 2026-04-30) The legacy ?missing=
              banner has been replaced by the chip strip inside ListView.
              Selected chips are visible directly above the table; the
              empty state offers a Clear filters button. */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {years.length > 1 && (
              <Select value={yearFilter} onValueChange={(val) => setYearFilter(val ?? "all")}>
                <SelectTrigger className="w-28">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex border rounded-md overflow-hidden text-xs">
              <button
                className={`px-3 py-1.5 font-medium transition-colors ${modeFilter === "all" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                onClick={() => setModeFilter("all")}
              >All</button>
              <button
                className={`px-3 py-1.5 font-medium transition-colors border-x ${modeFilter === "food_truck" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                onClick={() => setModeFilter("food_truck")}
              >🚚 Vending</button>
              <button
                className={`px-3 py-1.5 font-medium transition-colors ${modeFilter === "catering" ? "bg-brand-teal text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}
                onClick={() => setModeFilter("catering")}
              >🍽️ Catering</button>
            </div>
            {initialEvents.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                onClick={handleDeleteAll}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {deleting ? "Deleting..." : "Delete All"}
              </Button>
            )}
          </div>
          <ListView
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            selectedChips={selectedChips}
            handleChipToggle={handleChipToggle}
            handleClearChips={handleClearChips}
            sortField={sortField}
            setSortField={setSortField}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            bookingId={bookingId}
            setBookingId={setBookingId}
            setEditingEvent={setEditingEvent}
            setSalesEvent={setSalesEvent}
            setDuplicatingEvent={setDuplicatingEvent}
            initialEvents={initialEvents}
            tabCounts={tabCounts}
            tabFilteredCounts={tabFilteredCounts}
            filtered={filtered}
            sorted={sorted}
            weatherMap={weatherMap}
            today={today}
            eventNameById={eventNameById}
            contactByEventId={contactByEventId}
            handleTabChange={handleTabChange}
            handleSort={handleSort}
            handleDuplicate={handleDuplicate}
            handleDelete={handleDelete}
            handleQuickBook={handleQuickBook}
            handleDismiss={handleDismiss}
            tableDensity={tableDensity}
            handleTableDensity={handleTableDensity}
            highlightedEventId={highlightedEventId}
            financialsVisible={financialsVisible}
          />
        </>
      )}

      {/* Share Schedule Modal */}
      {showShareModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowShareModal(false); }}
        >
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Share to Social Media</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowShareModal(false)}>
                ✕
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              Paste this into Instagram, Facebook, or X to share your schedule.
            </p>

            <textarea
              ref={shareTextRef}
              readOnly
              className="w-full h-52 rounded-md border bg-muted p-3 text-sm font-mono resize-none focus:outline-none"
              value={shareText}
            />

            <Button
              className="w-full gap-2"
              onClick={handleCopyShare}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy to Clipboard
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Create Event Dialog */}
      <EventForm
        open={showForm}
        onOpenChange={setShowForm}
        onSubmit={handleCreate}
        profileState={userState}
        recentStates={recentStates}
        recentEventsForLinkage={initialEvents}
        canSeeFinancials={financialsVisible}
      />

      {/* Edit Event Dialog — always mounted so Base UI dialog can open/close correctly */}
      <EventForm
        open={!!editingEvent}
        onOpenChange={(open) => !open && setEditingEvent(null)}
        onSubmit={handleUpdate}
        initialData={editingEvent}
        title="Edit Event"
        profileState={userState}
        recentStates={recentStates}
        recentEventsForLinkage={initialEvents}
        canSeeFinancials={financialsVisible}
      />

      {/* Duplicate Event Dialog — opens a pre-filled create form with cleared sales/dates */}
      <EventForm
        open={!!duplicatingEvent}
        onOpenChange={(open) => !open && setDuplicatingEvent(null)}
        onSubmit={handleCreate}
        initialData={duplicatingEvent}
        title="Duplicate Event"
        profileState={userState}
        recentStates={recentStates}
        recentEventsForLinkage={initialEvents}
        canSeeFinancials={financialsVisible}
      />

      {/* Sales Entry Dialog — always mounted for same reason */}
      <SalesEntryDialog
        open={!!salesEvent}
        onOpenChange={(open) => !open && setSalesEvent(null)}
        event={salesEvent}
        onSubmit={handleSalesEntry}
      />
    </div>
  );
}
