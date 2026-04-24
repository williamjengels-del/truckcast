-- Billing payment tracking on profiles
--
-- Why this exists:
--
-- The Stripe webhook handler today reacts to checkout + subscription
-- lifecycle events but ignores invoice events. Once a subscription is
-- active, every renewal fires `invoice.payment_succeeded` or
-- `invoice.payment_failed` — and when a card expires or a charge gets
-- declined, VendCast has no trail of it. The operator's tier silently
-- stays on `pro` while their card has been failing for three days and
-- they're about to bounce to `starter` via `customer.subscription.deleted`
-- with no warning.
--
-- This migration adds the state we need to land before the webhook
-- handler itself (see handler at src/app/api/stripe/webhook/route.ts).
-- Dunning UI + operator-facing "your payment failed, please update your
-- card" messaging can layer on later — this is the DB side.
--
-- Design notes:
--
-- * `last_payment_at` — timestamp of the most recent successful
--   invoice.payment_succeeded. Nullable until the first renewal.
--
-- * `last_payment_status` — small enum-ish text. Keep the vocabulary
--   narrow so app code can branch on it without a type-juggle:
--     "paid"              — last invoice settled successfully
--     "payment_failed"    — invoice.payment_failed, possibly retrying
--     "past_due"          — Stripe status moved to past_due (subscription-level signal)
--     NULL                — no invoice events observed yet (trial or new)
--
-- * `last_payment_failure_reason` — free-text, nullable. Populated from
--   the Stripe invoice's last_payment_error.message when payment_failed
--   fires. Cleared back to NULL on the next successful renewal so it
--   only reflects the currently-unresolved failure, not historical.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_status TEXT
    CHECK (last_payment_status IN ('paid', 'payment_failed', 'past_due')),
  ADD COLUMN IF NOT EXISTS last_payment_failure_reason TEXT;

-- Partial index on the failing side — admin triage views + dunning
-- workers want "show me everyone whose last payment didn't settle."
-- We don't need an index for the paid-side because that's every user's
-- typical state; scan is fine.
CREATE INDEX IF NOT EXISTS profiles_last_payment_status_failing_idx
  ON profiles (last_payment_status)
  WHERE last_payment_status IN ('payment_failed', 'past_due');
