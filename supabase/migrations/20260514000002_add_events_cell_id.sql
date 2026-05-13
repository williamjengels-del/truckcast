-- Phase 2 address-required canonicalization, Phase 1: add cell_id.
--
-- Spawned 2026-05-14 from the address-required planning doc
-- (Briefs/vendcast_planning_address-required-canonicalization_2026-05-14.md).
-- Operator-locked decisions 2026-05-10/13/14:
--   * Cross-op canonicalization is keyed by venue address (geocoded),
--     not event_name.
--   * Geocoder: Mapbox (free tier, server-side only).
--   * Cell precision: 100m grid — tight enough to disambiguate distinct
--     venues, loose enough to forgive slight Mapbox-geocode jitter on
--     repeat lookups of the same address string.
--   * The Address column is `events.location` (already in place). This
--     migration only adds the cluster KEY.
--
-- cell_id encoding: `<lat_int>_<lng_int>` where each int is
--   Math.round(coord * 1000). At 1/1000 degree precision:
--     * lat: 111m N-S (constant)
--     * lng: 87m E-W at 38° latitude (St. Louis); 100m at the equator;
--            varies with latitude. ~100m grid for US operators.
-- Two events at the same geocoded venue land in the same cell even if
-- Mapbox returns slightly different coords on repeat lookups.
--
-- Index is PARTIAL (`WHERE cell_id IS NOT NULL`) — most events will
-- have cell_id populated only after operator + Mapbox token are active,
-- so the index stays small until backfill (Phase 3) catches up.
--
-- Engine integration (Phase 2 of the planning doc, separate session):
--   * getPlatformEventsExcludingUser will union cell-keyed aggregates
--     with the existing name-keyed aggregates. Privacy floor (op_count
--     >= 2 per cell) still applies.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cell_id TEXT;

CREATE INDEX IF NOT EXISTS events_cell_id_idx
  ON events (cell_id)
  WHERE cell_id IS NOT NULL;
