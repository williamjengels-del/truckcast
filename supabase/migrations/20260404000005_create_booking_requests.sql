CREATE TABLE IF NOT EXISTS booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_phone TEXT,
  event_date DATE,
  event_type TEXT,
  estimated_attendance INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Truck owners can read their own requests" ON booking_requests FOR SELECT USING (auth.uid() = truck_user_id);
CREATE POLICY "Anyone can submit a booking request" ON booking_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Truck owners can update their own requests" ON booking_requests FOR UPDATE USING (auth.uid() = truck_user_id);
