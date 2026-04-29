-- chat_v2_usage — per-request token usage + cost for the Tier-B
-- (tool-calling) chatbot.
--
-- Why a row per request, not aggregated:
--   * Each /api/chat-v2 turn spans 1-7 Anthropic messages.create
--     calls (one per agent-loop round). Storing the cumulative
--     turn-level usage matches the operator's mental model of "one
--     question, one cost."
--   * Aggregation queries (month-to-date for cap enforcement, weekly
--     spend for telemetry) run server-side over this table.
--
-- Cap enforcement reads month_to_date_cents per user_id; cap is
-- enforced at the route layer in src/app/api/chat-v2/route.ts via
-- src/lib/chat-v2-usage.ts:checkMonthlyCap.
--
-- 90-day retention via cron — see src/app/api/cron/ for the existing
-- cleanup pattern. This migration only creates the table; the cron
-- task is a separate small follow-up.

CREATE TABLE IF NOT EXISTS chat_v2_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Cumulative across the agent-loop rounds for one /api/chat-v2 POST.
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  -- Pre-computed cost in cents. Pricing constants live in
  -- src/lib/chat-v2-usage.ts so they're versionable; this column
  -- is a snapshot at the time the request happened.
  cost_cents integer NOT NULL DEFAULT 0,
  -- Number of tool calls dispatched this turn (≤ MAX_TOOL_CALLS_PER_TURN).
  tool_calls integer NOT NULL DEFAULT 0,
  -- Anthropic stop_reason — "end_turn" | "max_tokens" | "max_rounds_exceeded" | etc.
  stop_reason text NULL,
  -- True if the agent loop hit MAX_TOOL_CALLS_PER_TURN.
  truncated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_v2_usage_user_id_created_at
  ON chat_v2_usage(user_id, created_at DESC);

-- RLS: operators can read their own usage rows (so a future "your
-- AI usage this month" UI can render without an admin endpoint).
-- Inserts go through the service-role client in the route handler;
-- operators cannot self-insert.
ALTER TABLE chat_v2_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own chat_v2 usage"
  ON chat_v2_usage
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE chat_v2_usage IS
  'Tier-B chatbot per-turn usage telemetry. See src/lib/chat-v2-usage.ts.';
