-- Intended tier on profiles (signup plan-pickup persistence)
--
-- Why this exists:
--
-- /pricing CTA links route to /signup?plan=<tier>&billing=<period>.
-- PR #41 surfaced the chosen plan as a brand-teal banner above the
-- signup form. Without persistence, that intent dies at form submit;
-- the operator gets to /dashboard/settings on day-2 with no memory of
-- which tier they originally clicked. This column carries the
-- intent through onboarding so PlanCards can pre-highlight the
-- matching tier.
--
-- Design notes:
--
-- * Nullable by default. Direct signups (operators who landed at
--   /signup without coming from /pricing) carry no intent — that's
--   correct, they made no plan choice yet.
--
-- * CHECK constraint matches PRICING_PLANS' tier values exactly:
--   ('starter','pro','premium'). If a new tier is added to
--   src/lib/pricing-plans.ts, this constraint must be updated to
--   match. The existing src/lib/pricing-plans.test.ts already asserts
--   PRICING_PLANS / STRIPE_PLANS alignment; consider adding a similar
--   assertion against this CHECK list if a 4th tier ever lands.
--
-- * Distinct from subscription_tier:
--     subscription_tier — the operator's CURRENT tier. Always
--       'starter' on signup, updated by Stripe webhooks when they
--       pay. RLS / billing logic reads this.
--     intended_tier    — what they ORIGINALLY CHOSE on /pricing.
--       Set once at signup (or null if they came in direct), never
--       overwritten. Read by /dashboard/settings PlanCards to
--       pre-highlight the matching tier card.
--
-- * No index at this stage. Reads happen on /dashboard/settings for
--   the current authenticated user, RLS-scoped to a single row.
--   Add an index later if we ever query by intended_tier across
--   users (e.g. funnel analytics: did operators who clicked Pro
--   actually upgrade to Pro?).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS intended_tier TEXT
    CHECK (
      intended_tier IS NULL
      OR intended_tier IN ('starter', 'pro', 'premium')
    );
