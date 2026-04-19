-- Add state column to events for weather-geocoding disambiguation and
-- future cross-state reporting. Nullable — historical events stay
-- unset and the operator fills in state next time they edit, per
-- product call. New event creation will require state at the form
-- level; this DB column stays nullable so the migration is non-
-- destructive and stale rows don't block queries.

alter table public.events
  add column if not exists state text;
