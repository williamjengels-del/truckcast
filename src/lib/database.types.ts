export type SubscriptionTier = "starter" | "pro" | "premium";
export type EventType =
  // Current food-truck taxonomy (reclassification 2026-05-17, migration
  // 20260517000001/2). One coherent axis: what kind of revenue moment.
  | "Food Destination"
  | "Festival/Fair"
  | "Office/Workday Lunch"
  | "Concert/Sports"
  | "Community Event"
  | "Private Event"
  // Catering taxonomy.
  | "Wedding"
  | "Corporate"
  | "Private Party"
  | "Reception"
  | "Fundraiser/Charity"
  // Legacy values — retained for historical rows + CSV round-trip,
  // hidden from new-event selectors. Superseded by the types above.
  | "Festival"
  | "Concert"
  | "Community/Neighborhood"
  | "Weekly Series"
  | "Private"
  | "Private/Catering"
  | "Sports Event";
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
  /** Per-operator opt-out for new-device login email notifications.
   *  Migration 20260429000003 adds the column with default true. Used
   *  by src/app/api/auth/record-login/route.ts to gate the SMTP send;
   *  profile_login_events recording is unaffected. */
  login_notifications_enabled?: boolean | null;
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
  /** 100m grid cell key derived from latitude+longitude when the
   *  address geocoder resolves (migration 20260514000002).
   *  Format: `${Math.round(lat*1000)}_${Math.round(lng*1000)}`. Null
   *  until the operator saves an address with the Mapbox token live,
   *  OR for events that pre-date Phase 1 (1,300+ rows backfilled
   *  separately via TSV-and-confirm in Phase 3). Engine's cross-op
   *  match unions name-keyed + cell-keyed aggregates when non-null. */
  cell_id?: string | null;
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
  /** Bayesian v2 shadow columns (migration
   *  20260508000001_add_forecast_bayesian_shadow_columns.sql).
   *  All nullable; populated by recalculateForUser when the v2 engine
   *  produces a result. UI surfaces don't read these in v1 of the
   *  shadow rollout — they exist for the calibration-report script
   *  and for eventual UI flip once validation completes. */
  forecast_bayesian_point?: number | null;
  forecast_bayesian_low_80?: number | null;
  forecast_bayesian_high_80?: number | null;
  forecast_bayesian_low_50?: number | null;
  forecast_bayesian_high_50?: number | null;
  forecast_bayesian_n_obs?: number | null;
  forecast_bayesian_prior_src?: "platform" | "operator" | "default" | null;
  forecast_bayesian_insufficient?: boolean | null;
  forecast_bayesian_computed_at?: string | null;
  /** Event size tier columns (migration
   *  20260509000001_add_event_size_tier.sql). Foundation for the
   *  major-event-tag workstream — engine partitions per-event-name
   *  posterior by tier so flagship nights aren't averaged with typical
   *  nights. event_size_tier_inferred is auto-derived from
   *  actual / venue_median. event_size_tier_operator is the operator
   *  override (set on event form or by clicking the tier chip).
   *  Effective tier = operator ?? inferred ?? 'NORMAL' (see
   *  src/lib/event-size-tier.ts:effectiveTier). All nullable until the
   *  migration applies + first recalc populates inferred values. */
  event_size_tier_inferred?: "SMALL" | "NORMAL" | "LARGE" | "FLAGSHIP" | null;
  event_size_tier_operator?: "SMALL" | "NORMAL" | "LARGE" | "FLAGSHIP" | null;
  event_size_tier_inferred_at?: string | null;
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
  /** Day-of card v1 (migration 20260430000001). All operator-edited
   *  per-event cockpit fields. RLS-scoped via existing user_id policy. */
  parking_loadin_notes: string | null;
  menu_type: "regular" | "special";
  special_menu_details: string | null;
  in_service_notes: { timestamp: string; text: string }[];
  content_capture_notes: string | null;
  after_event_summary: {
    final_sales: number | null;
    wrap_up_note: string | null;
    what_id_change: string | null;
  } | null;
  /** Audit field — set by server-side auto-end when end_time passes
   *  without operator action. Null = still active OR operator-marked
   *  complete OR not yet ended. */
  auto_ended_at: string | null;
  /** Sample-data flag (migration 20260502000005). True for rows seeded
   *  by the new-user "see VendCast with data" experience preview.
   *  Cleared via /api/sample-data/clear. Default false on all real rows. */
  is_sample: boolean;
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
  /** City + location: added 2026-05-11 to parallel events.city /
   *  events.location. Operator-facing copy treats them the same way the
   *  events table does — city is the postal city; location is the
   *  venue/address free-text. */
  city: string | null;
  location: string | null;
  notes: string | null;
  /** Reserved for the deferred contact-scoring workstream. NOT being
   *  used today; populate manually if desired but no read-path depends
   *  on it. */
  quality_score: number | null;
  /** Legacy soft-link by event name. Kept in place for one rollout
   *  cycle; new writes prefer linked_event_ids below. Reads should
   *  prefer ids and fall back to names. */
  linked_event_names: string[];
  /** Real FK array to events.id. v1 implementation (migration
   *  20260512000001) — operator-curated, no auto-linking. If/when
   *  scoring ships, this gets promoted to a contact_events junction
   *  table via a 15-line follow-up migration. */
  linked_event_ids: string[];
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
  // Single Financials toggle — when true, manager sees revenue,
  // forecasts, and post-event sales entry. Operations access (events,
  // inquiries, calendar, contacts, notes) is always on for any active
  // manager and not gated by this flag.
  financials_enabled: boolean;
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
  // Cross-operator Phase 1 aggregates (migration 20260502000001).
  // Null until the next recompute pass populates them. Privacy floor
  // 2+ contributing operators enforced at compute time in
  // platform-registry.ts (same gate as median_sales).
  median_other_trucks: number | null;
  median_attendance: number | null;
  // Cross-operator fee aggregates (migration 20260502000002).
  // Privacy floor 3+ operators (slightly stricter than other Phase 1
  // aggregates because fee + event_name combined leans more identifying).
  modal_fee_type: string | null;
  median_fee_rate: number | null;
  // Cross-operator Phase 2 — modal weather per (event_name × month-of-year).
  // Shape: { "1": { weather: "Cold", count: 4 }, ..., "12": { ... } }.
  // Months below 3+ operator floor are absent from the jsonb. Migration
  // 20260502000003.
  modal_weather_by_month: Record<string, { weather: string; count: number }> | null;
  // Cross-operator Phase 3 — per-DOW lift vs event median across operators.
  // Shape: { "0": { lift_pct: -8, count: 4 }, ..., "6": { ... } }.
  // dow indexed 0=Sun..6=Sat (Date.getDay()). lift_pct is integer % above
  // (positive) or below (negative) the event-wide median. DOWs below 3+
  // operator floor absent. Migration 20260502000004.
  dow_lift: Record<string, { lift_pct: number; count: number }> | null;
  updated_at: string;
}

// Phase 7 Event Marketplace — Inquiry Distribution.
// Public-submit table; one inquiry routes to N operators via
// matched_operator_ids. Operator actions tracked in operator_actions
// jsonb keyed by operator UUID. Migration 20260502000006.
export type EventInquiryStatus = "open" | "closed" | "expired";
export type EventInquiryAction = "claimed" | "declined" | "contacted";
export interface EventInquiryOperatorAction {
  action: EventInquiryAction;
  at: string; // ISO timestamp
}
export interface EventInquiry {
  id: string;
  organizer_name: string;
  organizer_email: string;
  organizer_phone: string | null;
  organizer_org: string | null;
  event_name: string | null;
  event_date: string;
  event_start_time: string | null;
  event_end_time: string | null;
  event_type: string;
  expected_attendance: number | null;
  city: string;
  state: string;
  location_details: string | null;
  budget_estimate: number | null;
  notes: string | null;
  status: EventInquiryStatus;
  matched_operator_ids: string[];
  operator_actions: Record<string, EventInquiryOperatorAction>;
  // Per-operator private notes, keyed by user_id. Each operator
  // sees only their own slot. Server-enforced via RLS on the parent
  // row.
  operator_notes_by_user: Record<string, string>;
  created_at: string;
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
