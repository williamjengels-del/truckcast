// Event Types
export const EVENT_TYPES = [
  "Festival",
  "Concert",
  "Community/Neighborhood",
  "Corporate",
  "Weekly Series",
  "Private/Catering",
  "Sports Event",
  "Fundraiser/Charity",
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

// Tier colors for UI
export const TIER_COLORS: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-yellow-100 text-yellow-800 border-yellow-300",
  D: "bg-gray-100 text-gray-800 border-gray-300",
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

// US States
export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];
