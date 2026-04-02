-- Enums for TruckCast
CREATE TYPE subscription_tier AS ENUM ('starter', 'pro', 'premium');

CREATE TYPE event_type AS ENUM (
  'Festival',
  'Concert',
  'Community/Neighborhood',
  'Corporate',
  'Weekly Series',
  'Private/Catering',
  'Sports Event',
  'Fundraiser/Charity'
);

CREATE TYPE event_tier AS ENUM ('A', 'B', 'C', 'D');

CREATE TYPE weather_type AS ENUM (
  'Clear',
  'Overcast',
  'Hot',
  'Cold',
  'Rain Before Event',
  'Rain During Event',
  'Storms',
  'Snow'
);

CREATE TYPE anomaly_flag AS ENUM ('normal', 'disrupted', 'boosted');

CREATE TYPE fee_type AS ENUM ('none', 'flat_fee', 'percentage', 'commission_with_minimum', 'pre_settled');

CREATE TYPE pos_source AS ENUM ('manual', 'square', 'toast', 'clover', 'mixed');

CREATE TYPE confidence_level AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TYPE trend_type AS ENUM ('Growing', 'Declining', 'Stable', 'New/Insufficient Data');
