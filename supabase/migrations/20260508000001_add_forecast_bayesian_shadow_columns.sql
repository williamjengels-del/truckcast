-- Shadow columns for the Bayesian v2 forecast engine.
--
-- Phase 3 Step 3 of the engine-fix plan. Adds nullable columns on
-- the events table to store v2 forecasts ALONGSIDE the existing v1
-- forecast_sales / forecast_low / forecast_high / forecast_confidence.
-- The v1 columns continue to drive every operator-facing UI surface;
-- v2 is shadow-only until validation completes.
--
-- All columns are nullable so the migration applies cleanly with no
-- backfill required. The next recalculateForUser run will populate
-- them for the operator's history. Code in src/lib/recalculate.ts
-- writes to these columns wrapped in a separate UPDATE so a missing-
-- column error (migration not yet applied) doesn't poison the v1
-- write — the v1 path keeps working either way.
--
-- Inherits RLS policies from the events table (user_id-scoped read +
-- write for the row's owner; service role for admin paths). No new
-- policies needed.
--
-- Why these specific columns:
--   forecast_bayesian_point      — predictive mean revenue (the
--                                  main "what should I expect" number)
--   forecast_bayesian_low_80     — 10th percentile of predictive
--                                  distribution (lower bound of 80%
--                                  credible interval)
--   forecast_bayesian_high_80    — 90th percentile (upper bound of
--                                  80% credible interval)
--   forecast_bayesian_low_50     — 25th percentile (50% interval)
--   forecast_bayesian_high_50    — 75th percentile (50% interval)
--   forecast_bayesian_n_obs      — number of operator observations
--                                  of this event_name that contributed
--                                  to the posterior (diagnostic)
--   forecast_bayesian_prior_src  — which prior was used: 'platform',
--                                  'operator', or 'default' (diagnostic)
--   forecast_bayesian_insufficient
--                                — true when posterior median fell
--                                  below the insufficient-data floor
--                                  (mirrors v1 semantic)
--   forecast_bayesian_computed_at
--                                — when the values were last written;
--                                  lets the calibration report flag
--                                  rows that haven't been recomputed
--                                  since the last engine change
--
-- Migration is paste-at-merge. Operator runs this in the Supabase
-- SQL editor when merging the recalc-integration PR. Code does NOT
-- crash if the columns don't exist yet — see the try/catch in
-- recalculate.ts.

alter table public.events
  add column if not exists forecast_bayesian_point        numeric,
  add column if not exists forecast_bayesian_low_80       numeric,
  add column if not exists forecast_bayesian_high_80      numeric,
  add column if not exists forecast_bayesian_low_50       numeric,
  add column if not exists forecast_bayesian_high_50      numeric,
  add column if not exists forecast_bayesian_n_obs        integer,
  add column if not exists forecast_bayesian_prior_src    text,
  add column if not exists forecast_bayesian_insufficient boolean,
  add column if not exists forecast_bayesian_computed_at  timestamptz;

-- Light constraint on prior_src so future code can rely on the values.
-- Done as a CHECK rather than an ENUM so future additions (per-event-
-- type priors, hierarchical priors) don't require dropping a type.
alter table public.events
  drop constraint if exists forecast_bayesian_prior_src_valid;
alter table public.events
  add constraint forecast_bayesian_prior_src_valid
  check (
    forecast_bayesian_prior_src is null
    or forecast_bayesian_prior_src in ('platform', 'operator', 'default')
  );

-- Index on computed_at to make the calibration-report script's
-- "rows recomputed since X" query fast. Partial index because most
-- rows will be NULL until the operator's first post-merge recalc.
create index if not exists events_forecast_bayesian_computed_at_idx
  on public.events (forecast_bayesian_computed_at)
  where forecast_bayesian_computed_at is not null;
