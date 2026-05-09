-- Event size tier — operator-tagged "is this a big or small night?".
--
-- Foundation for the major-event-tag workstream (see
-- Briefs/vendcast_scoping_event-size-tier_2026-05-08.md). The 2026-05-08
-- calibration audit found the engine averages all events at a venue
-- together, swamping flagship nights with small Tuesday-night events.
-- Tier lets the engine partition the per-event-name posterior so a
-- Zach Bryan night isn't averaged with open-mic Tuesday.
--
-- Three columns, all nullable so the migration applies cleanly with no
-- backfill required. The next recalculateForUser run populates
-- event_size_tier_inferred for every event with actuals.
--
-- Why TEXT + CHECK instead of an ENUM:
--   Same precedent as forecast_bayesian_prior_src in migration
--   20260508000001 — future tier additions or renames don't require
--   dropping a Postgres type.
--
-- Why two tier columns (inferred + operator):
--   inferred = auto-derived from actual / venue median when actuals
--              come in. Free, no operator action required (honors the
--              feedback_no_friction_inputs rule).
--   operator = explicit operator override when the auto-inference is
--              wrong, OR pre-tag set on the booking form before
--              actuals exist.
--   Effective tier = operator ?? inferred ?? 'NORMAL' (computed in
--   src/lib/event-size-tier.ts:effectiveTier).
--
-- Inherits RLS policies from the events table (user_id-scoped read +
-- write for the row's owner; service role for admin paths). No new
-- policies needed.
--
-- Migration is paste-at-merge. Operator runs this in the Supabase SQL
-- editor when merging the foundation PR. Code probes for the columns
-- before writing — see probeEventSizeTierColumns in recalculate.ts.

alter table public.events
  add column if not exists event_size_tier_inferred     text,
  add column if not exists event_size_tier_operator     text,
  add column if not exists event_size_tier_inferred_at  timestamptz;

-- Constrain both tier columns to the four enum values.
alter table public.events
  drop constraint if exists event_size_tier_inferred_valid;
alter table public.events
  add constraint event_size_tier_inferred_valid
  check (
    event_size_tier_inferred is null
    or event_size_tier_inferred in ('SMALL', 'NORMAL', 'LARGE', 'FLAGSHIP')
  );

alter table public.events
  drop constraint if exists event_size_tier_operator_valid;
alter table public.events
  add constraint event_size_tier_operator_valid
  check (
    event_size_tier_operator is null
    or event_size_tier_operator in ('SMALL', 'NORMAL', 'LARGE', 'FLAGSHIP')
  );

-- Partial index on user_id + event_name + COALESCE(operator, inferred).
-- Used by the engine partition logic (PR 3) to fetch only same-tier
-- events at the same venue when computing the per-event-name posterior.
-- Partial index because most rows will have at least one tier value
-- after the first recalc; rows with neither set default to 'NORMAL' at
-- read time, so they're not interesting for the partitioned query.
create index if not exists events_size_tier_user_name_idx
  on public.events (
    user_id,
    event_name,
    coalesce(event_size_tier_operator, event_size_tier_inferred)
  )
  where event_size_tier_operator is not null
     or event_size_tier_inferred is not null;
