CREATE TABLE IF NOT EXISTS testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  author_title TEXT,
  content TEXT NOT NULL,
  rating INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- No RLS needed — public read, admin write via service role
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active testimonials" ON testimonials FOR SELECT USING (is_active = true);
