-- Expand booking_requests with fields the public inquiry form now collects:
--   location         — venue / address (required at the app layer)
--   start_time       — event start (optional)
--   end_time         — event end (optional)
--   attendance_range — bucketed crowd size (required at the app layer)
--
-- All columns are nullable at the database level so pre-existing rows
-- (submitted before this change) don't violate constraints. The API route
-- (POST /api/book/submit) enforces location + attendance_range as required
-- for new submissions. The existing estimated_attendance column is kept
-- for historical continuity; new submissions populate attendance_range
-- instead.

alter table public.booking_requests
  add column if not exists location text,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists attendance_range text;
