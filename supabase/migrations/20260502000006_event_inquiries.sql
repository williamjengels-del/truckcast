-- Phase 7a — Event Marketplace (Inquiry Distribution)
-- Companion brief: Briefs/vendcast_planning_phase7-event-marketplace_2026-05-02.md
--
-- Public inquiry-routing table. Organizers submit one form at
-- /request-event; the inquiry is routed to operators that match by
-- city + event type. Operators see it in /dashboard/inquiries
-- (separate from /dashboard/bookings which remains 1:1 booking).
--
-- Critically: VendCast does NOT mediate the operator <-> organizer
-- conversation. Operators respond directly using the organizer's
-- email/phone from the inquiry. VendCast just routes the lead and
-- tracks operator-side actions (claim / decline / contacted).
--
-- Schema choices:
--   - Single-table design with matched_operator_ids as uuid[] +
--     operator_actions as jsonb. Avoids a join table at small scale;
--     GIN index on matched_operator_ids keeps fan-out queries fast.
--   - status enum: open / closed / expired. Closed = manually closed
--     by organizer or admin. Expired = past event_date by N days
--     (cron in 7c).
--   - operator_actions shape: { "<operator-uuid>": { "action":
--     "claimed" | "declined" | "contacted", "at": "<iso>" } }
--
-- RLS:
--   - Public INSERT (anyone can submit; rate-limit lives in the
--     server route)
--   - SELECT scoped to operators whose UUID is in matched_operator_ids
--   - UPDATE scoped same way (so operators can record their own
--     action against the inquiry)
--   - DELETE: no policy (defaults to deny — only service role can
--     delete)

CREATE TABLE IF NOT EXISTS event_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Organizer info
  organizer_name TEXT NOT NULL,
  organizer_email TEXT NOT NULL,
  organizer_phone TEXT,
  organizer_org TEXT,

  -- Event details
  event_name TEXT,
  event_date DATE NOT NULL,
  event_start_time TIME,
  event_end_time TIME,
  event_type TEXT NOT NULL,
  expected_attendance INTEGER,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  location_details TEXT,
  budget_estimate INTEGER,
  notes TEXT,

  -- Routing + state
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
  matched_operator_ids UUID[] NOT NULL DEFAULT '{}',
  operator_actions JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_inquiries_status
  ON event_inquiries (status);
CREATE INDEX IF NOT EXISTS idx_event_inquiries_matched_ops
  ON event_inquiries USING GIN (matched_operator_ids);
CREATE INDEX IF NOT EXISTS idx_event_inquiries_event_date
  ON event_inquiries (event_date);

-- Auto-bump updated_at on row updates (mirrors pattern from
-- event_performance / events).
CREATE TRIGGER event_inquiries_updated_at
  BEFORE UPDATE ON event_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE event_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read matched inquiries"
  ON event_inquiries FOR SELECT
  TO authenticated
  USING (auth.uid() = ANY(matched_operator_ids));

CREATE POLICY "Operators update their own actions"
  ON event_inquiries FOR UPDATE
  TO authenticated
  USING (auth.uid() = ANY(matched_operator_ids));

-- Public INSERT — anyone can submit the form. Rate limit lives in
-- the server route, not RLS, since RLS can't easily count requests
-- per IP.
CREATE POLICY "Anyone can submit inquiries"
  ON event_inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

COMMENT ON TABLE event_inquiries IS
  'Phase 7 event marketplace. Public-submit table; one inquiry routes to N operators via matched_operator_ids array. Operator actions tracked in operator_actions jsonb keyed by operator UUID. See Briefs/vendcast_planning_phase7-event-marketplace_2026-05-02.md for the full brief.';
