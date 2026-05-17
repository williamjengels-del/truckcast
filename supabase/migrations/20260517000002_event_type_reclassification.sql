-- Event-type taxonomy reclassification (2026-05-17) — STEP 2 of 2.
--
-- Run AFTER 20260517000001 has committed (Postgres requires the new
-- enum values to exist before they can be assigned here).
--
-- Two passes:
--   1. Mechanical — maps each legacy food-truck type onto its new-axis
--      equivalent.
--   2. Name overrides — venue / event character beats the mechanical
--      default. 9 Mile Garden is a Food Destination even though it was
--      filed under Weekly Series; conventions are Concert/Sports even
--      when filed as Corporate; breweries are Community Events; etc.
--      The override pass runs SECOND so it wins.
--
-- Platform-wide (all operators) by design — the engine's event-type
-- clustering needs one coherent taxonomy across operators. Operator-
-- approved mapping 2026-05-17.

-- ── Pass 1 — mechanical, by legacy event_type ───────────────────────
UPDATE events SET event_type = 'Festival/Fair'
  WHERE event_type = 'Festival';

UPDATE events SET event_type = 'Concert/Sports'
  WHERE event_type IN ('Concert', 'Sports Event');

UPDATE events SET event_type = 'Community Event'
  WHERE event_type IN ('Community/Neighborhood', 'Fundraiser/Charity')
    AND event_mode = 'food_truck';

UPDATE events SET event_type = 'Office/Workday Lunch'
  WHERE event_type = 'Corporate'
    AND event_mode = 'food_truck';

UPDATE events SET event_type = 'Private Event'
  WHERE event_type IN ('Private', 'Private/Catering')
    AND event_mode = 'food_truck';

-- ── Pass 2 — name overrides ─────────────────────────────────────────
UPDATE events SET event_type = 'Food Destination'
  WHERE event_name ILIKE ANY (ARRAY[
    '9 Mile Garden',
    '9 Mile Garden Pop Up Market',
    '9 Mile Garden First Responders Appreciation Day',
    'Food Truck Fridays',
    'Food Truck Friday',
    'BJC Food Truck Friday',
    'Laumeier Fridays',
    'Finally Fridays at Laumeier',
    'Food Truck Night',
    'Fenton Food Truck Nights'
  ]);

UPDATE events SET event_type = 'Private Event'
  WHERE event_name ILIKE ANY (ARRAY[
    '9 Mile Garden Private Party',
    '9 Mile Garden Special Party'
  ]);

UPDATE events SET event_type = 'Office/Workday Lunch'
  WHERE event_name ILIKE ANY (ARRAY[
    'Lunchtime Live',
    'Lunchtime Live in Kiener Plaza',
    'Lunch on the Landing',
    'WashU Indoor Station Takeover',
    'Cardinal Glennon Lunch',
    'Cortex Food Truck Tuesday'
  ]);

UPDATE events SET event_type = 'Community Event'
  WHERE event_name ILIKE ANY (ARRAY[
    'Hidden Gems Bar',
    'Hidden Gems Drag Show',
    'Wellspent Brewery',
    'Wellspent Brewery 5th Anniversary Party',
    'Rockwell Beer Garden',
    'Rockwell Brewing Company',
    'Millipond Brewing',
    'Happy Hour',
    'Pre-Party Salsa Congress',
    'Service Industry Night',
    'Wok-O Salsa Night',
    'Fellowship of Catholic University Students'
  ]);

UPDATE events SET event_type = 'Concert/Sports'
  WHERE event_name ILIKE ANY (ARRAY[
    'Sunset Series',
    'Summer Concert Series',
    'Chesterfield Amphitheater',
    'Vex Robotics at the Convention Center',
    'Geekway @ St. Charles Convention Center',
    'Volleyball Tournament at America''s Center',
    'Spring North America Bridge Championship',
    'Disc Golf Event'
  ]);

UPDATE events SET event_type = 'Festival/Fair'
  WHERE event_name ILIKE ANY (ARRAY[
    'Market Off Market Street',
    'Night at the Zoo'
  ]);
