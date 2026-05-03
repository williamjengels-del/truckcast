// Event Types
//
// Split by mode so EventForm can offer the semantically-correct subset
// based on the operator's food_truck ↔ catering toggle. See migration
// 20260421000001 for the enum additions (Private, Wedding, Private
// Party, Reception) that underpin these lists.
//
// Corporate and Fundraiser/Charity legitimately appear in both modes
// — a corporate lunch can be a truck parked at an office picnic OR
// a catered drop-off, and a fundraiser can be either a public gate
// event or a catered gala. Both modes can target the same event_type.
//
// The legacy "Private/Catering" value is deliberately absent from BOTH
// lists. Existing rows carrying that value still render (enum value
// retained for backward compat); new events land on one of the new
// mode-specific types as operators select them.

export const EVENT_TYPES_FOOD_TRUCK = [
  "Festival",
  "Concert",
  "Community/Neighborhood",
  "Corporate",
  "Weekly Series",
  "Private",
  "Sports Event",
  "Fundraiser/Charity",
] as const;

export const EVENT_TYPES_CATERING = [
  "Wedding",
  "Corporate",
  "Private Party",
  "Reception",
  "Fundraiser/Charity",
] as const;

// Union of both lists, deduped — used where the UI doesn't know which
// mode applies yet (admin cross-tenant filter, public booking form
// where inquirers can tag any event type, CSV parser validation).
// Order preserves food-truck-first then catering-only additions so
// the most common shapes for existing operators surface first.
export const EVENT_TYPES = [
  "Festival",
  "Concert",
  "Community/Neighborhood",
  "Corporate",
  "Weekly Series",
  "Private",
  "Sports Event",
  "Fundraiser/Charity",
  "Wedding",
  "Private Party",
  "Reception",
] as const;

// Event Tiers with descriptions
export const EVENT_TIERS = {
  A: "Destination events — high attendance, strong brand recognition",
  B: "Solid recurring events — predictable, bread and butter",
  C: "Smaller/newer events — less predictable, worth trying",
  D: "Niche/low-value — low turnout, often not worth the gas",
} as const;

// Weather Types
export const WEATHER_TYPES = [
  "Clear",
  "Overcast",
  "Hot",
  "Cold",
  "Rain Before Event",
  "Rain During Event",
  "Storms",
  "Snow",
] as const;

// Fee Types with labels
export const FEE_TYPES = {
  none: "No Fee",
  flat_fee: "Flat Fee",
  percentage: "Percentage",
  commission_with_minimum: "Commission with Minimum",
  pre_settled: "Pre-Settled",
} as const;

// Cancellation Reasons
export const CANCELLATION_REASONS = {
  weather: "Weather (rain, heat, etc.)",
  truck_breakdown: "Truck / Equipment Issue",
  organizer_cancelled: "Organizer Cancelled",
  // sold_out: high-demand cancellation — a previous event ran inventory
  // dry, leaving nothing to sell at the next one. Recorded as a
  // cancellation so the slot doesn't sit "booked-but-no-sales" in
  // reminders; downstream stats can split this from the negative
  // reasons later if useful.
  sold_out: "Sold Out (Inventory Depleted)",
  other: "Other",
} as const;

// Anomaly Flags
export const ANOMALY_FLAGS = {
  normal: "Normal",
  disrupted: "Disrupted (excluded from stats)",
  boosted: "Boosted (abnormally high)",
} as const;

// POS Sources
export const POS_SOURCES = {
  manual: "Manual Entry",
  square: "Square",
  toast: "Toast",
  clover: "Clover",
  mixed: "Mixed",
} as const;

// Weather Coefficients for forecast adjustment
export const WEATHER_COEFFICIENTS: Record<string, number> = {
  Clear: 1.0,
  Overcast: 0.95,
  "Rain Before Event": 0.95,
  Hot: 0.63,
  Cold: 0.55,
  "Rain During Event": 0.53,
  Storms: 0.3,
  Snow: 0.2,
};

// Day of Week Coefficients
export const DAY_OF_WEEK_COEFFICIENTS: Record<string, number> = {
  Saturday: 1.15,
  Friday: 1.05,
  Sunday: 1.0,
  Monday: 0.85,
  Tuesday: 0.85,
  Wednesday: 0.85,
  Thursday: 0.85,
};

// Event-quality tier colors (A/B/C/D grades from forecast engine).
// Data semantics — kept on raw palette per v23-design rule (financial /
// data classification colors aren't brand-relevant).
export const TIER_COLORS: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-yellow-100 text-yellow-800 border-yellow-300",
  D: "bg-gray-100 text-gray-800 border-gray-300",
};

// Subscription tier colors (starter / pro / premium). On brand tokens
// per Verdict #25: premium = brand-orange (the differentiator/closer),
// pro = brand-teal (default brand presence), starter = muted (lowest
// emphasis). Single source of truth — admin users-client + user-detail
// page both read this.
export const SUBSCRIPTION_TIER_COLORS: Record<string, string> = {
  starter: "bg-muted text-muted-foreground",
  pro: "bg-brand-teal/15 text-brand-teal",
  premium: "bg-brand-orange/15 text-brand-orange",
};

// Confidence colors
export const CONFIDENCE_COLORS: Record<string, string> = {
  HIGH: "bg-green-100 text-green-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  LOW: "bg-red-100 text-red-800",
};

// Trend colors
export const TREND_COLORS: Record<string, string> = {
  Growing: "text-green-600",
  Declining: "text-red-600",
  Stable: "text-blue-600",
  "New/Insufficient Data": "text-gray-500",
};

// US Timezones
export const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

// US States (ISO 3166-2 two-letter codes, DC included)
export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

// Sentinel value used when an operator's event is outside the US state
// set — Canadian provinces, Mexico, Puerto Rico, etc. Treated as a
// first-class dropdown option in EventForm / signup / CSV import.
// Stored as literal "OTHER" in events.state.
export const OTHER_STATE = "OTHER";

// Full state names for dropdown display. Code → name.
export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

// Event mode colors (catering = violet, food truck = existing primary)
export const EVENT_MODE_COLORS = {
  food_truck: "bg-primary/10 text-primary border-primary/20",
  catering: "bg-violet-100 text-violet-800 border-violet-300",
} as const;
