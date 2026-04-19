-- Add four new event_type enum values to support cleaner mode-aware
-- categorization. See Commit D (event_type ↔ event_mode split) for
-- the full rationale:
--
--   * Private        — food truck parked at a private venue running
--                      variable-sales walk-up service (company picnic
--                      in a parking lot, neighborhood party). Belongs
--                      in food_truck mode.
--   * Wedding        — catering-mode only. Canonical wedding catering.
--   * Private Party  — catering-mode only. Umbrella for holiday
--                      parties, birthdays, anniversaries, graduations.
--   * Reception      — catering-mode only. Post-ceremony receptions,
--                      corporate receptions.
--
-- The legacy "Private/Catering" value is deliberately NOT removed —
-- existing rows with that value remain valid. New event-creation UIs
-- hide it from the selector; operators upgrade historical rows
-- naturally as they edit them.

ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Private';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Wedding';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Private Party';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Reception';
