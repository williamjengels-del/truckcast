export type SubscriptionTier = "starter" | "pro" | "premium";
export type EventType =
  | "Festival"
  | "Concert"
  | "Community/Neighborhood"
  | "Corporate"
  | "Weekly Series"
  | "Private/Catering"
  | "Sports Event"
  | "Fundraiser/Charity";
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
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  onboarding_completed: boolean;
  data_sharing_enabled: boolean;
  email_reminders_enabled?: boolean | null;
  team_share_token?: string | null;
  trial_extended_until?: string | null;
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
  food_cost: number | null;
  labor_cost: number | null;
  other_costs: number | null;
  notes: string | null;
  pos_source: PosSource;
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
  estimated_attendance: number | null;
  message: string | null;
  status: "new" | "read" | "replied" | "declined";
  created_at: string;
}

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
