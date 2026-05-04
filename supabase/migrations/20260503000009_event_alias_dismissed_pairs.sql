-- Dismissed alias-suggestion pairs.
--
-- The /dashboard/admin/event-aliases page surfaces pairs of
-- platform_events bucket keys that look similar (Levenshtein +
-- Jaccard heuristics) but aren't currently aliased. Some of those
-- pairs are real near-misses worth aliasing; others are just
-- coincidentally similar event names ("Food Truck Friday" vs "Food
-- Truck Friday Fenton" — same words, different events). Once an
-- admin decides a pair is NOT an alias, persist that decision so
-- the suggestion list doesn't keep nagging.
--
-- Pair key shape: '<lower-norm>||<higher-norm>' — sorted lexically
-- so dismissing A↔B is the same as dismissing B↔A. Computed in app
-- code; the table just stores the canonicalized string.

CREATE TABLE event_alias_dismissed_pairs (
  pair_key       TEXT PRIMARY KEY,
  dismissed_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE event_alias_dismissed_pairs ENABLE ROW LEVEL SECURITY;

-- No public reads — admin API is the only legitimate consumer and
-- runs as service-role. RLS without policies means non-service
-- callers see nothing, which is what we want.
