-- Public slug on profiles (first stage of custom vendor profiles)
--
-- Why this exists:
--
-- The public vendor profile workstream in v10/v11 is an operator-distribution
-- lever: `vendcast.co/<slug>` renders the operator's public presence (upcoming
-- events, contact, booking widget) at a shareable URL. Stage 1 lands the DB
-- column and constraints; stages 2+ build the slug-picker UI, the public
-- page route, and the embed widget coupling.
--
-- Design notes:
--
-- * Nullable by default. Existing profiles carry no slug until the operator
--   opts in — no auto-assignment from business_name because slug choice is a
--   branding decision, not a system one.
--
-- * UNIQUE with partial index `WHERE public_slug IS NOT NULL`. Multiple
--   users with NULL slug should not collide; only claimed slugs need
--   uniqueness. A plain UNIQUE would treat every NULL as distinct in
--   Postgres, which is actually fine, but the partial-index form is more
--   explicit about intent and faster at scale.
--
-- * Check constraint caps the lexical shape: 3-40 lowercase alphanum +
--   hyphens, must start with a letter, cannot end with a hyphen, cannot
--   contain consecutive hyphens. Mirrors GitHub / Linear / etc. conventions
--   so operators have existing intuition. Reserved-slug enforcement (admin,
--   api, dashboard, signup, etc.) happens at the app layer — the DB
--   doesn't know the route table.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS public_slug TEXT
    CHECK (
      public_slug IS NULL
      OR (
        length(public_slug) BETWEEN 3 AND 40
        AND public_slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
      )
    );

-- Partial unique index so NULL slugs don't compete.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_slug_unique_idx
  ON profiles (public_slug)
  WHERE public_slug IS NOT NULL;
