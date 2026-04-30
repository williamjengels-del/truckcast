-- profiles.chat_v2_monthly_cap_cents_override — per-operator override of
-- the Tier-B chatbot monthly cost cap.
--
-- Default behavior (NULL): use the env-configurable global cap from
-- src/lib/chat-v2-usage.ts (chatV2MonthlyCapCents()), which falls back to
-- $10/operator/month (CHAT_V2_DEFAULT_CAP_CENTS = 1000).
--
-- When set to a positive integer (cents), this overrides the env value
-- for this operator only — useful when a power user requests a higher
-- ceiling, or when investigating a specific operator's usage by
-- temporarily raising their cap. Values <= 0 are treated as null
-- (use the env default) by chatV2MonthlyCapCents().
--
-- Mutated only via the admin tool on /dashboard/admin/users/[userId];
-- every set/unset is audit-logged as user.cap_override_set so the
-- activity feed reflects the change.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS chat_v2_monthly_cap_cents_override integer NULL;

COMMENT ON COLUMN profiles.chat_v2_monthly_cap_cents_override IS
  'Per-operator override (cents) of the Tier-B chatbot monthly cap. NULL = use env default. Mutated only via admin tool, audit-logged.';
