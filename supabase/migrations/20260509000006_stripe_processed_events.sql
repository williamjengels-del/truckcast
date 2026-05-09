-- Stripe webhook idempotency.
--
-- Pre-migration: the webhook handler had zero replay protection. A
-- captured webhook payload could be replayed (or Stripe could retry
-- after a borderline-timeout response) and the SAME event.id would
-- run the switch case again — flipping subscription_tier or clearing
-- last_payment_failure_reason on data that had since moved on.
--
-- Worst case from v49 §11: replay of customer.subscription.deleted
-- after an operator had re-upgraded would silently downgrade them
-- back to starter, no signal.
--
-- Fix: track every processed event.id. The webhook checks the table
-- before running the switch; on hit, returns 200 without reprocessing.
-- After successful processing, inserts the row.
--
-- Service-role-only — RLS enabled with NO policies, so only the
-- service-role key (used by the webhook handler's getAdminSupabase())
-- can read or write.
--
-- 30-day prune is recommended via a cron (out of scope for this
-- migration; brief includes a note for the next session). Stripe
-- doesn't replay events older than ~30 days anyway.

CREATE TABLE IF NOT EXISTS stripe_processed_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stripe_processed_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS stripe_processed_events_processed_at_idx
  ON stripe_processed_events (processed_at);

-- Comment for ops: rows older than ~30 days are safe to delete (Stripe
-- doesn't replay older events). Add a cron when convenient — not
-- urgent, the table grows ~10 rows/month at typical volume.
COMMENT ON TABLE stripe_processed_events IS
  'Idempotency tracking for Stripe webhook events. Service-role only. Safe to prune rows older than 30 days.';
