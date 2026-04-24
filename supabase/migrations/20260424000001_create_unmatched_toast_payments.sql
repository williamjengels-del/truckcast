-- Inbox table for Toast-reported sales that couldn't be auto-matched to
-- a booked event.
--
-- Why this exists:
--
-- Toast sends a daily summary email with the day's total sales. The
-- /api/pos/toast/inbound webhook parses that email and tries to update
-- `events.net_sales` on the booked event matching the reported date.
-- That works for vending / storefront days where "the day you took the
-- money == the day the event happened."
--
-- It FALSE for the catering payment pattern. Catering customers pay a
-- deposit on day X for an event on day Y (Y > X, usually weeks later).
-- Toast records the deposit on day X, VendCast looks for a booked event
-- on day X and finds nothing, the sales silently get discarded. Same
-- issue for final-balance payments after an event.
--
-- Rather than drop the data, we now insert unmatched reports here.
-- Operator sees an "unmatched Toast payments — review" inbox in the
-- dashboard and manually routes each payment to the right event. Value
-- flows into that event's `net_sales` (vending) or `invoice_revenue`
-- (catering).
--
-- Design notes:
--
-- * One row per unmatched webhook. Resolving is recorded in-place
--   (resolved_at + resolved_action) so the row stays as history, not
--   deleted. Makes "how much Toast data was routed manually" a
--   queryable audit trail.
--
-- * `resolved_action` is a narrow enum-ish text field. Keep the
--   vocabulary small — app code branches on it.
--     "assigned_to_event" — payment was routed to resolved_event_id
--     "dismissed"         — operator confirmed it shouldn't sync (duplicate,
--                            bad parse, etc.)
--
-- * No hard FK on resolved_event_id to allow operator to later delete
--   an event without losing the audit row. Use SET NULL on event delete.
--
-- * `source` is future-proofing — Square / Clover / SumUp may hit the
--   same mismatch pattern once we wire their webhooks through the same
--   reconciliation flow. Default "toast" keeps today's callers simple.

create table if not exists public.unmatched_toast_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- What Toast reported
  source text not null default 'toast',
  reported_date date not null,
  net_sales numeric(10, 2) not null,
  raw_subject text,

  -- Resolution state
  resolved_at timestamptz,
  resolved_action text check (
    resolved_action in ('assigned_to_event', 'dismissed')
  ),
  resolved_event_id uuid references public.events(id) on delete set null,
  resolved_by_user_id uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Primary access: "show me my unresolved inbox, newest first."
-- Partial index makes the "WHERE resolved_at IS NULL" query cheap even
-- when the historical table grows. We intentionally don't index resolved
-- rows — they're only read in per-event history drilldowns, which
-- index by resolved_event_id below.
create index if not exists unmatched_toast_payments_inbox_idx
  on public.unmatched_toast_payments(user_id, created_at desc)
  where resolved_at is null;

-- Secondary access: "what payments did I assign to this event?"
create index if not exists unmatched_toast_payments_resolved_event_idx
  on public.unmatched_toast_payments(resolved_event_id)
  where resolved_event_id is not null;

alter table public.unmatched_toast_payments enable row level security;

-- Users can see their own unmatched payments.
create policy "Users can view own unmatched toast payments"
  on public.unmatched_toast_payments for select
  using (auth.uid() = user_id);

-- Users can update their own unmatched payments (resolve them).
-- Inserts go through the service role in /api/pos/toast/inbound, so no
-- insert policy — end users can't fabricate rows.
create policy "Users can resolve own unmatched toast payments"
  on public.unmatched_toast_payments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
