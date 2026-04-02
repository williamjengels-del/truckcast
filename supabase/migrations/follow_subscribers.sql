-- Follow My Truck: subscriber table for Premium tier email notifications

create table if not exists follow_subscribers (
  id uuid primary key default gen_random_uuid(),
  truck_user_id uuid not null references profiles(id) on delete cascade,
  email text not null,
  name text,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  confirmed boolean not null default false,
  unique (truck_user_id, email)
);

-- Index for fast lookups by truck owner
create index idx_follow_subscribers_truck_user on follow_subscribers(truck_user_id);

-- RLS
alter table follow_subscribers enable row level security;

-- Truck owners can read their own subscribers
create policy "Truck owners can read own subscribers"
  on follow_subscribers for select
  using (auth.uid() = truck_user_id);

-- Public can insert (subscribe)
create policy "Public can subscribe"
  on follow_subscribers for insert
  with check (true);

-- Public can update (for unsubscribe — sets unsubscribed_at)
create policy "Public can update for unsubscribe"
  on follow_subscribers for update
  using (true)
  with check (true);
