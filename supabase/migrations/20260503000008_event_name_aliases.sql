-- Event-name aliases let admins map near-miss spellings of the same
-- real-world event onto a single canonical bucket key, so the
-- platform_events aggregate accumulates contributions from operators
-- who typed slightly different names ("Saturday Farmer's Market" vs
-- "Saturday Farmers Market") without forcing them to converge at
-- entry time.
--
-- The autocomplete shipped earlier today (#168) is the proactive nudge
-- — guides operators toward the canonical bucket while typing. This
-- aliases table is the corrective tool — admin can clean up existing
-- splits after the fact.
--
-- Design notes:
--   * Primary key is alias_normalized. Each alias normalizes (lowercase
--     + trim) to a single canonical normalized form. No chains —
--     enforced in app code: alias.canonical must not itself appear
--     as another row's alias_normalized, and alias.alias must not
--     appear as another row's canonical_normalized.
--   * Display strings stored alongside so the admin UI can show the
--     original casing/spacing without a join back to platform_events.
--   * Reads are authenticated (event names aren't PII; both
--     server-side updatePlatformRegistry and client-side EventForm
--     hint lookup need read access). Writes go through the admin API
--     using service-role.

CREATE TABLE event_name_aliases (
  alias_normalized      TEXT PRIMARY KEY,
  canonical_normalized  TEXT NOT NULL,
  alias_display         TEXT NOT NULL,
  canonical_display     TEXT NOT NULL,
  created_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alias_not_self CHECK (alias_normalized != canonical_normalized)
);

CREATE INDEX idx_event_name_aliases_canonical
  ON event_name_aliases (canonical_normalized);

ALTER TABLE event_name_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read event name aliases"
  ON event_name_aliases FOR SELECT
  USING (auth.role() = 'authenticated');
