-- Feedback table for user feedback collection
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  email TEXT,
  page TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert their own feedback
DO $$ BEGIN
  CREATE POLICY "Users can insert own feedback"
    ON feedback FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only service role can read all feedback (no SELECT policy for authenticated users)
