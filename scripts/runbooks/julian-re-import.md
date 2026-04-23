# Runbook — Julian's Own CSV Re-Import

**Flagged in:** `vendcast_session_brief_2026-04-19_v6.md` Section 11 step 4 (own re-import before Nick reactivation).

**Purpose:** once the Airtable audit is clean, load Julian's historical event data into VendCast via the CSV import flow. Runs AFTER event purge, BEFORE Nick reactivation — that order matters so impersonation and forecast comparisons downstream have accurate Julian baseline.

Companion to [`nick-reactivation.md`](./nick-reactivation.md). Intentionally shorter — Julian knows his own data, so steps like spot-checking and anomaly fixing fold together.

---

## Prerequisites

1. **Airtable audit complete.** The semi-cleaned state from the 2026-04 Cowork damage has to be fully reconciled first. Outside Claude's scope.
2. **Event purge done.** See [`event-purge.md`](./event-purge.md). Pre-purge, the events table still has test data from other users — Julian's own events will import fine, but the pre-Nick state won't be clean.

---

## Step 1 — Export Airtable by year

From the cleaned Airtable base, export year by year:
- `julian-2022.csv` (partial — v6 brief notes 2022 events were recovered from a separately-saved event list after the Cowork damage)
- `julian-2023.csv`
- `julian-2024.csv`
- `julian-2025.csv`
- `julian-2026.csv` (through today)

Year-scoped batches play best with `batch-default-state` and `batch-default-mode` defaults. A single-year batch is also small enough to skim.

---

## Step 2 — Log in as Julian (self, not admin)

This is a self-import via the Dashboard, not the admin panel. Different flow than Nick's.

1. Log in to https://vendcast.co with Julian's account.
2. Go to **Dashboard → Integrations → CSV Import tab** (or Events page → "Import" button once that lands; v6 noted discoverability deferred).

---

## Step 3 — Import each year

For each year's CSV:

1. Upload file
2. Configure batch defaults in the preview:
   | Field | Value |
   |---|---|
   | Batch-default state | `MO` |
   | Batch-default event mode | `food_truck` (Julian has both food_truck and catering — but the **majority default**; catering events should be overridden on the rows that need it, OR filtered into a separate import batch if clean) |
3. Review the preview — spot-check 3-5 random rows
4. Confirm

**If Julian has meaningful catering vs food_truck split in a single year**, consider two passes per year: filter CSV to catering-only rows first (default mode = catering), then food_truck-only (default mode = food_truck). Cleaner than row-by-row override.

Alternative: since Julian is self-importing, just leave the default as food_truck and edit individual catering events after import via the regular event edit UI (not admin — regular user event edit). That's fine if the catering count is small.

---

## Step 4 — Verify in own dashboard

No impersonation needed — Julian is logged in as himself.

Check:
- [ ] Events show up on calendar at the right dates
- [ ] Notes render multi-line where CSV had embedded newlines (now working after the `218f252` Papaparse fix — regression-tested)
- [ ] `net_sales` looks right per event
- [ ] Forecast engine populating
- [ ] Catering events are flagged as catering (not food_truck) — fix per-event if mis-classified

---

## Step 5 — Fix any leftover issues via regular event edit

Same event-edit UI a normal user uses. Go event-by-event, fix what's off. No admin impersonation needed since Julian is editing his own events.

For any mode misclassification from step 3: edit event → change mode → save. Forecast engine re-runs on the next aggregate.

For disruptions (weather-cancelled events, short-attendance, etc.) — set the anomaly flag so forecast engine excludes them from comparables.

---

## Step 6 — Confirm readiness for Nick reactivation

Before kicking off Nick:
- [ ] All of Julian's years imported
- [ ] No orphaned events from the purge era
- [ ] Forecast numbers look reasonable on the dashboard
- [ ] No "No date found" or parse errors lingering
- [ ] Event count matches Airtable (±a few for known duplicates)

Then follow [`nick-reactivation.md`](./nick-reactivation.md) from step 1.

---

## Recovery

- **Wrong-year import** — scoped DELETE in Supabase SQL editor (wrapped in `BEGIN;`/`ROLLBACK;`):
  ```sql
  BEGIN;
  DELETE FROM events
  WHERE user_id = '7f97040f-023d-4604-8b66-f5aa321c31de'::uuid
    AND event_date BETWEEN '2024-01-01' AND '2024-12-31';
  -- verify count, then:
  COMMIT;
  ```
  Re-import the correct file.
- **Mass-wrong data across all years** — Supabase PITR to before step 3. Take a manual backup before step 3 as insurance.

---

## After this is done

Next real step is Nick reactivation — see [`nick-reactivation.md`](./nick-reactivation.md). After Nick, the Toast Worker SPF fix and 2FA workstreams unblock per v6 brief Section 5.
