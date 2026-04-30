export type SubscriptionTier = "starter" | "pro" | "premium";
export type EventType =
  | "Festival"
  | "Concert"
  | "Community/Neighborhood"
  | "Corporate"
  | "Weekly Series"
  | "Private"
  | "Private/Catering" // legacy — retained for historical rows, hidden from new-event selects
  | "Sports Event"
  | "Fundraiser/Charity"
  | "Wedding"
  | "Private Party"
  | "Reception";
export type EventTier = "A" | "B" | "C" | "D";
export type WeatherType =
  | "Clear"
  | "Overcast"
  | "Hot"
  | "Cold"
  | "Rain Before Event"
  | "Rain During Event"
  | "Storms"
  | "Snow";
export type AnomalyFlag = "normal" | "disrupted" | "boosted";
export type CancellationReason =
  | "weather"
  | "truck_breakdown"
  | "organizer_cancelled"
  | "sold_out"
  | "other";
export type EventMode = "food_truck" | "catering";
export type FeeType =
  | "none"
  | "flat_fee"
  | "percentage"
  | "commission_with_minimum"
  | "pre_settled";
export type PosSource = "manual" | "square" | "toast" | "clover" | "sumup" | "mixed";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type TrendType =
  | "Growing"
  | "Declining"
  | "Stable"
  | "New/Insufficient Data";

export interface Profile {
  id: string;
  business_name: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  subscription_tier: SubscriptionTier;
  /** What the operator clicked on /pricing before reaching /signup.
   *  Set once at signup from URL params, never overwritten. Distinct
   *  from subscription_tier (the current tier). Read by
   *  /dashboard/settings PlanCards to pre-highlight the matching
   *  tier card. */
  intended_tier?: SubscriptionTier | null;
  /** Custom URL slug for the operator's public profile. Resolved at
   *  vendcast.co/<slug> by the Stage-3 public route (separate PR).
   *  Picker UI lives in src/components/public-slug-picker.tsx, mounted
   *  on /dashboard/settings's Public Schedule card. Lexical shape +
   *  uniqueness enforced by migration 20260424000003 + DB unique
   *  index; reserved-list guard in src/lib/public-slug.ts. */
  public_slug?: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  onboarding_completed: boolean;
  data_sharing_enabled: boolean;
  email_reminders_enabled?: boolean | null;
  team_share_token?: string | null;
  owner_user_id?: string | null;
  trial_extended_until?: string | null;
  /** Per-operator override (cents) of the Tier-B chatbot monthly cap.
   *  NULL = use env default (CHAT_V2_MONTHLY_CAP_CENTS, fallback $10).
   *  Mutated only via the admin tool on /dashboard/admin/users/[userId].
   *  Migration 20260429000005. */
  chat_v2_monthly_cap_cents_override?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: string;
  user_id: string;
  event_name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  setup_time: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  city_area: string | null;
  latitude: number | null;
  longitude: number | null;
  booked: boolean;
  is_private?: boolean;
  net_sales: number | null;
  invoice_revenue: number;
  event_type: EventType | null;
  event_tier: EventTier | null;
  event_weather: WeatherType | null;
  anomaly_flag: AnomalyFlag;
  event_mode: EventMode;
  expected_attendance: number | null;
  other_trucks: number | null;
  fee_type: FeeType;
  fee_rate: number;
  sales_minimum: number;
  net_after_fees: number | null;
  forecast_sales: number | null;
  forecast_low: number | null;
  forecast_high: number | null;
  forecast_confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  food_cost: number | null;
  labor_cost: number | null;
  other_costs: number | null;
  notes: string | null;
  pos_source: PosSource;
  cancellation_reason: CancellationReason | null;
  /** Optional link to a prior event whose outcome caused this cancellation
   *  (e.g., Saturday sold out → Sunday cancelled with sold_out reason and
   *  caused_by_event_id pointing at Saturday). Migration 20260429000004
   *  adds the FK with ON DELETE SET NULL. Stats engine excludes rows
   *  with this set from forecast accuracy denominators (PR b). Display
   *  layer renders "Sold out (carry-over from X)" instead of "$0 sales." */
  caused_by_event_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventPerformance {
  id: string;
  user_id: string;
  event_name: string;
  times_booked: number;
  total_sales: number;
  avg_sales: number;
  median_sales: number;
  min_sales: number;
  max_sales: number;
  consistency_score: number;
  yoy_growth: number | null;
  confidence: ConfidenceLevel;
  confidence_band_low: number | null;
  confidence_band_high: number | null;
  trend: TrendType;
  years_active: string | null;
  forecast_next: number | null;
  notes: string | null;
  updated_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
  notes: string | null;
  quality_score: number | null;
  linked_event_names: string[];
  created_at: string;
  updated_at: string;
}

export type PosProvider = "square" | "clover" | "toast" | "sumup";

export interface TeamMember {
  id: string;
  owner_user_id: string;
  member_user_id: string | null;
  member_email: string;
  status: "pending" | "active";
  can_view_revenue: boolean;
  can_view_forecasts: boolean;
  created_at: string;
}

export interface PosConnection {
  id: string;
  user_id: string;
  provider: PosProvider;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  merchant_id: string | null;
  location_ids: string[];
  selected_location_ids: string[];
  location_names: Record<string, string>; // { locationId: locationName }
  sync_enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string;
  last_sync_error: string | null;
  last_sync_events_updated: number | null;
  created_at: string;
  updated_at: string;
}

export interface Testimonial {
  id: string;
  author_name: string;
  author_title: string | null;
  content: string;
  rating: number;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface BookingRequest {
  id: string;
  truck_user_id: string;
  requester_name: string;
  requester_email: string;
  requester_phone: string | null;
  event_date: string | null;
  event_type: string | null;
  // Legacy integer column — kept for historical rows. New form collects
  // attendance_range instead; submissions from /api/book/submit leave
  // estimated_attendance null.
  estimated_attendance: number | null;
  attendance_range: string | null;
  location: string | null;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
  status: "new" | "read" | "replied" | "declined";
  created_at: string;
}

export const ATTENDANCE_RANGES = [
  "Under 50",
  "50\u2013100",
  "100\u2013250",
  "250\u2013500",
  "500+",
] as const;
export type AttendanceRange = (typeof ATTENDANCE_RANGES)[number];

export interface WeatherCache {
  id: string;
  date: string;
  latitude: number;
  longitude: number;
  max_temp_f: number | null;
  min_temp_f: number | null;
  precipitation_in: number | null;
  prev_day_precip_in: number | null;
  weather_classification: WeatherType | null;
  fetched_at: string;
}

export interface FollowSubscriber {
  id: string;
  truck_user_id: string;
  email: string;
  name: string | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
  confirmed: boolean;
}

export interface Feedback {
  id: string;
  user_id: string | null;
  email: string | null;
  page: string | null;
  message: string;
  created_at: string;
}

export interface PlatformEvent {
  id: string;
  event_name_normalized: string;
  event_name_display: string;
  operator_count: number;
  total_instances: number;
  median_sales: number | null;
  avg_sales: number | null;
  min_sales: number | null;
  max_sales: number | null;
  sales_p25: number | null;
  sales_p75: number | null;
  most_common_event_type: string | null;
  most_common_city: string | null;
  updated_at: string;
}

export type UnmatchedPaymentResolution = "assigned_to_event" | "dismissed";

export interface UnmatchedToastPayment {
  id: string;
  user_id: string;
  source: string;
  reported_date: string;
  net_sales: number;
  raw_subject: string | null;
  resolved_at: string | null;
  resolved_action: UnmatchedPaymentResolution | null;
  resolved_event_id: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
}
