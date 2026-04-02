-- POS Connections table
-- Stores OAuth tokens and sync metadata for Square, Clover, and other POS providers.
CREATE TABLE pos_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider pos_source NOT NULL CHECK (provider IN ('square', 'clover', 'toast')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  merchant_id TEXT,
  location_ids TEXT[] DEFAULT '{}',
  selected_location_ids TEXT[] DEFAULT '{}',
  sync_enabled BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT DEFAULT 'never',
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider)
);

-- Indexes
CREATE INDEX idx_pos_connections_user ON pos_connections(user_id);
CREATE INDEX idx_pos_connections_provider ON pos_connections(user_id, provider);

-- Updated_at trigger
CREATE TRIGGER pos_connections_updated_at
  BEFORE UPDATE ON pos_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE pos_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pos connections"
  ON pos_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own pos connections"
  ON pos_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pos connections"
  ON pos_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pos connections"
  ON pos_connections FOR DELETE
  USING (auth.uid() = user_id);
