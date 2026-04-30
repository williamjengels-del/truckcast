import type { Event } from "./database.types";

export type EventsTab = "all" | "upcoming" | "past" | "needs_attention";

export type ChipCategory = "status" | "field";

export interface EventChip {
  id: string;
  label: string;
  category: ChipCategory;
  /** Whether selecting this chip clears other chips in the same
   *  category (radio behavior). True for status; false for field. */
  radioInCategory: boolean;
  /** Predicate over an Event row. Receives the operator-local "today"
   *  YYYY-MM-DD string so date-relative chips don't re-do the math. */
  predicate: (event: Event, today: string) => boolean;
}

// ─── Predicate helpers ─────────────────────────────────────────────────

const isCancelled = (e: Event) => !!e.cancellation_reason;
const isBooked = (e: Event) => e.booked && !e.cancellation_reason;
const isUnbookedInquiry = (e: Event) =>
  !e.booked && !e.cancellation_reason;

const isMissingType = (e: Event) => !e.event_type;
const isMissingWeather = (e: Event) => !e.event_weather;
const isMissingLocation = (e: Event) => !e.location && !e.city;
const isMissingSales = (e: Event, today: string) =>
  e.event_date < today &&
  e.booked &&
  !e.cancellation_reason &&
  e.net_sales === null &&
  !(e.event_mode === "catering" && e.invoice_revenue > 0) &&
  e.anomaly_flag !== "disrupted" &&
  e.fee_type !== "pre_settled";
const isMissingCancellationReason = (e: Event) =>
  !e.booked && e.cancellation_reason === null && false;
// ^ The "missing cancellation reason" case as written today is
//   structurally vacuous: cancellation_reason IS NULL means "not
//   cancelled" in our schema, so there's nothing to flag. Kept as a
//   defined-but-never-true predicate so the chip can be wired up in
//   the UI for future evolution (e.g. if we ever introduce a
//   "cancelled but no reason given" sub-state). Hides correctly in
//   the empty state today.

// ─── Catalog ───────────────────────────────────────────────────────────

export const CHIP_CATALOG: EventChip[] = [
  // Status — mutually-exclusive radio within category.
  {
    id: "booked",
    label: "Booked",
    category: "status",
    radioInCategory: true,
    predicate: isBooked,
  },
  {
    id: "unbooked",
    label: "Unbooked inquiry",
    category: "status",
    radioInCategory: true,
    predicate: isUnbookedInquiry,
  },
  {
    id: "cancelled",
    label: "Cancelled",
    category: "status",
    radioInCategory: true,
    predicate: isCancelled,
  },

  // Field — multi-select. AND-composed when multiple selected.
  {
    id: "missing-type",
    label: "Missing event type",
    category: "field",
    radioInCategory: false,
    predicate: isMissingType,
  },
  {
    id: "missing-weather",
    label: "Missing weather",
    category: "field",
    radioInCategory: false,
    predicate: isMissingWeather,
  },
  {
    id: "missing-location",
    label: "Missing location",
    category: "field",
    radioInCategory: false,
    predicate: isMissingLocation,
  },
  {
    id: "missing-sales",
    label: "Missing sales",
    category: "field",
    radioInCategory: false,
    predicate: isMissingSales,
  },
  {
    id: "missing-cancellation-reason",
    label: "Missing cancellation reason",
    category: "field",
    radioInCategory: false,
    predicate: isMissingCancellationReason,
  },
];

const CHIP_BY_ID: Map<string, EventChip> = new Map(
  CHIP_CATALOG.map((c) => [c.id, c])
);

export function getChip(id: string): EventChip | undefined {
  return CHIP_BY_ID.get(id);
}

// ─── Defaults per tab ──────────────────────────────────────────────────

/**
 * Default chips per tab. Applied ONLY when ?chips= is absent from
 * the URL — preserves operator intent on deep-linked URLs.
 */
export const TAB_DEFAULT_CHIPS: Record<EventsTab, string[]> = {
  all: [],
  upcoming: ["booked"],
  past: ["booked"],
  needs_attention: [],
};

// ─── Tab-level scope ───────────────────────────────────────────────────

/**
 * Each tab is a hard scope; chips refine within.
 *
 * "Needs attention" default scope: events with at least one missing
 * critical field (type, weather, location, sales for past booked,
 * cancellation reason). When field chips are selected, the AND
 * narrowing in applyChips refines to specific gaps.
 */
export function eventInTabScope(
  event: Event,
  tab: EventsTab,
  today: string
): boolean {
  switch (tab) {
    case "all":
      return true;
    case "upcoming":
      return event.event_date >= today;
    case "past":
      return event.event_date < today;
    case "needs_attention":
      return (
        isMissingType(event) ||
        isMissingWeather(event) ||
        isMissingLocation(event) ||
        isMissingSales(event, today) ||
        isMissingCancellationReason(event)
      );
  }
}

// ─── Filter composition ────────────────────────────────────────────────

/**
 * Apply selected chip filters within an already-tab-scoped event list.
 *
 * Composition rules (locked 2026-04-29):
 *   - WITHIN a non-radio category: AND — every selected chip's
 *     predicate must match (e.g. missing-type AND missing-weather =
 *     events missing both fields).
 *   - WITHIN a radio category: only one chip can be selected at a
 *     time, enforced at toggle-time. The predicate of that chip must
 *     match.
 *   - ACROSS categories: AND — selected status AND selected field
 *     chips both apply.
 *
 * Empty selectedChipIds → returns events unchanged (no filtering).
 */
export function applyChips(
  events: Event[],
  selectedChipIds: ReadonlySet<string>,
  today: string
): Event[] {
  if (selectedChipIds.size === 0) return events;
  const chips: EventChip[] = [];
  for (const id of selectedChipIds) {
    const c = CHIP_BY_ID.get(id);
    if (c) chips.push(c);
  }
  if (chips.length === 0) return events;
  return events.filter((e) => chips.every((c) => c.predicate(e, today)));
}

/**
 * Toggle a chip in the selected set, enforcing radio behavior within
 * radio categories. Returns a new Set; does not mutate the input.
 */
export function toggleChip(
  selected: ReadonlySet<string>,
  chipId: string
): Set<string> {
  const chip = CHIP_BY_ID.get(chipId);
  if (!chip) return new Set(selected);
  const next = new Set(selected);
  if (next.has(chipId)) {
    next.delete(chipId);
    return next;
  }
  if (chip.radioInCategory) {
    // Clear other chips in the same category before adding this one.
    for (const otherId of next) {
      const other = CHIP_BY_ID.get(otherId);
      if (other && other.category === chip.category && other.radioInCategory) {
        next.delete(otherId);
      }
    }
  }
  next.add(chipId);
  return next;
}

// ─── URL serialization ─────────────────────────────────────────────────

export function chipsToParam(selected: ReadonlySet<string>): string {
  return [...selected].sort().join(",");
}

export function chipsFromParam(raw: string | null): Set<string> {
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const id of raw.split(",")) {
    const trimmed = id.trim();
    if (trimmed && CHIP_BY_ID.has(trimmed)) out.add(trimmed);
  }
  return out;
}

// ─── Backward-compat URL mapping ───────────────────────────────────────

/**
 * Map legacy ?tab= + ?missing= URL params to the new tab + chips
 * structure. Returns null when no legacy mapping applies.
 *
 * Legacy URLs operators may have bookmarked or shared:
 *   ?tab=upcoming        -> tab=upcoming, chips={"booked"}
 *   ?tab=unbooked        -> tab=upcoming, chips={"unbooked"}
 *   ?tab=past            -> tab=past, chips={"booked"}
 *   ?tab=past_unbooked   -> tab=past, chips={"unbooked"}
 *   ?tab=cancelled       -> tab=past, chips={"cancelled"}
 *   ?tab=flagged         -> tab=needs_attention, chips={"missing-sales"}
 *   ?missing=type        -> tab=needs_attention, chips={"missing-type"}
 *   ?missing=weather     -> tab=needs_attention, chips={"missing-weather"}
 *   ?missing=location    -> tab=needs_attention, chips={"missing-location"}
 */
export function legacyUrlMapping(
  legacyTab: string | null,
  legacyMissing: string | null
): { tab: EventsTab; chips: Set<string> } | null {
  if (legacyMissing) {
    const chipId = `missing-${legacyMissing}`;
    if (CHIP_BY_ID.has(chipId)) {
      return { tab: "needs_attention", chips: new Set([chipId]) };
    }
  }
  switch (legacyTab) {
    case "upcoming":
      return { tab: "upcoming", chips: new Set(["booked"]) };
    case "unbooked":
      return { tab: "upcoming", chips: new Set(["unbooked"]) };
    case "past":
      return { tab: "past", chips: new Set(["booked"]) };
    case "past_unbooked":
      return { tab: "past", chips: new Set(["unbooked"]) };
    case "cancelled":
      return { tab: "past", chips: new Set(["cancelled"]) };
    case "flagged":
      return { tab: "needs_attention", chips: new Set(["missing-sales"]) };
    case "all":
      return { tab: "all", chips: new Set() };
    case "needs_attention":
    case "needs-attention":
      return { tab: "needs_attention", chips: new Set() };
  }
  return null;
}

export function isValidTab(tab: string | null): tab is EventsTab {
  return (
    tab === "all" ||
    tab === "upcoming" ||
    tab === "past" ||
    tab === "needs_attention"
  );
}
