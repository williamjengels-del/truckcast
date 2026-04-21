# Runbook — Nick Reactivation

**Flagged in:** `vendcast_session_brief_2026-04-19_v6.md` Section 11 (event purge + Nick reactivation sequencing).

**What this is:** the "import Nick's historical data and hand him a clean dashboard" workstream. Expected outcome: Nick opens VendCast, sees his event history rendered correctly, can verify or correct anomalies, and is ready to connect Square for go-forward sales.

**Prerequisites (do these first, in order):**

1. **Julian's Airtable audit complete.** Until this is done, the data you'd import isn't trustworthy. Outside Claude's scope.
2. **Event purge done.** See [`event-purge.md`](./event-purge.md). All non-Julian non-Nick events deleted from prod. Run this before step 3 here, OR accept that other users' test events still exist (fine for Nick's experience since he only sees his own data).
3. **Julian's own re-import done** (year-by-year CSVs from cleaned Airtable). Verifying your own data looks right before showing Nick his is a sanity gate — if the import flow doesn't work for your data, fix it before running it on someone else's.

---

## Step 1 — Export Nick's Airtable

Julian's work, outside the app. Nick's base is separate and intact (per v6 brief — was not damaged by the Cowork session that hit Julian's base).

Export year by year, not all at once:
- Keeps each file small enough for quick spot-check
- Makes it easier to skip a year if one's corrupted
- CSV import has batch-default state/mode that work best on year-scoped batches

Save CSVs somewhere reachable — e.g. `Wok-O Taco/Nick reactivation/nick-2023.csv`, `nick-2024.csv`, `nick-2025.csv`.

---

## Step 2 — Spot-check each CSV

Open each file in a spreadsheet. Eyeball pass:

- [ ] Header row has `event_name`, `event_date`, `notes`, `net_sales` (and whatever else the import expects — see the import UI on prod for the canonical field list).
- [ ] Dates are parseable. No `Unknown` or empty rows.
- [ ] `net_sales` is a number where it exists. Notes column doesn't spill into `net_sales` (the embedded-newlines bug we fixed in `218f252` — now regression-tested).
- [ ] No Julian-specific events leaked in. Nick's file should only have Nick's events.
- [ ] Row count looks right for the year (roughly — if 2024 has 15 rows but Nick actually worked ~50 events, something's truncated).

If any file fails, fix it in Airtable and re-export. Don't import broken data and then clean it up per-row in VendCast — the admin event edit UI is for polish, not for bulk corrections.

---

## Step 3 — Import via admin panel

1. Log in to https://vendcast.co as Julian (your admin account).
2. Navigate to **Admin → Users → Nick Baur** (user detail page).
3. Find the **"Import events"** action on his detail page.
4. Upload one year's CSV at a time. Configure batch defaults:

| Field | Value |
|---|---|
| Batch-default state | `MO` (Missouri — adjust if Nick's events concentrate elsewhere) |
| Batch-default event mode | `food_truck` (Nick has no catering per v6 brief) |

5. Review the import preview carefully:
   - Row count matches CSV
   - Inferred `event_mode` counts look right (should be ~100% food_truck for Nick)
   - No "Unknown date" or parse warnings
6. Confirm import. Repeat for the next year.

**If a year imports with parse warnings:** cancel, fix the CSV, re-export, re-import. Don't commit dirty data thinking you'll fix it later.

---

## Step 4 — Impersonate Nick to verify

Use the admin impersonation feature (Commit `5d` — "View as" button on Nick's user detail page). This puts you in a read-only view of his dashboard without swapping auth sessions.

**The mutation block is working correctly** (verified against prod 2026-04-21 via Playwright + vitest — see [`tests/e2e/README.md`](../../tests/e2e/README.md)). Any attempt to mutate while impersonating will 403 with `x-impersonation-blocked: 1`. That's the intended behavior — you're read-only here.

What to check in Nick's dashboard view:
- [ ] Events show up on the calendar at the right dates
- [ ] Notes render multi-line where CSV had embedded newlines
- [ ] `net_sales` looks right per event (spot-check 3-5 known events)
- [ ] Forecast engine is populating (even with sparse history — the engine has 4 fallback levels)
- [ ] No "undefined" or blank fields in event cards
- [ ] Event list groups by year correctly

Take notes (or screenshots) of anything that looks off — you'll fix those in step 5 without needing to exit impersonation every time.

---

## Step 5 — Fix anomalies via admin UI

**Exit impersonation** before editing (click the same "View as" button, or hit `/api/admin/impersonate/stop`). Impersonation is read-only; edits go through the admin event editor.

For each anomaly Nick spotted or you noticed in step 4:
1. Admin → Events → find the event (search by date or name)
2. Edit the specific row in the admin event editor
3. If it's a disruption (weather, cancellation, short attendance), set the **anomaly flag** so the forecast engine excludes it from "comparable events"

**Batch anomalies, don't one-off.** If 8 events are flagged, do all 8 in one sitting — context-switching between "edit" and "impersonate" is slow.

---

## Step 6 — Re-impersonate to verify clean state

Same flow as step 4. Goal: nothing left to fix. You're signing off that Nick's dashboard is presentable.

---

## Step 7 — Text Nick

Draft from v6 brief Section 11:

> Your VendCast is ready — all our shared event data is loaded. Open it when you have a sec, delete anything that looks off.

Adjust tone to match your actual text history with Nick. The key conveyed items:
1. It's ready now
2. You've already done the heavy lift (he doesn't have to set up, just use)
3. You trust his judgment on residual data issues ("delete anything that looks off")
4. Low-pressure opening — "when you have a sec"

Send via whatever channel you usually text Nick. Don't bcc Rohini or anyone — this is a one-on-one handoff moment.

---

## Step 8 — Encourage Square connect for go-forward

Either in the same text or the follow-up: suggest Nick connect Square so his live sales flow into VendCast automatically. Per v6 brief: "backfill historical sales" — Square OAuth pulls his existing transaction history too, so he gets forecast improvements immediately.

Don't force this step. If Nick prefers manual sales entry for a while, that's fine — the forecast engine handles both.

---

## Failure modes + recovery

- **Import preview shows "X rows failed to parse"** — cancel. Check the CSV for malformed quotes, mixed encodings (should be UTF-8), or stray BOM characters. The parser handles RFC 4180 now (commit `218f252`), so failures are data-quality issues, not parser bugs.
- **Impersonation cookie expires mid-session** — 30 min fixed TTL. Click "View as" again.
- **You accidentally import the wrong year** — use admin event edit to bulk-delete by date range, then re-import. Worse case, run a scoped DELETE via Supabase SQL editor: `DELETE FROM events WHERE user_id = '<nick-uuid>' AND event_date BETWEEN '2024-01-01' AND '2024-12-31';` inside a `BEGIN;`/`ROLLBACK;` envelope.
- **Nick replies with "a bunch of these are wrong"** — that's expected. The first pass is bulk; the polish pass is him. Don't take it personally and don't re-import — edit in place.

---

## After Nick is live

The next workstream queued behind this (per v6 brief Section 5) is the **Toast sync Worker SPF fix** — actively leaking Toast data since ca. April 19. If Nick connects Square and not Toast, this blocks less. If Nick connects Toast, fix the Worker first.

Flag this runbook as done in whatever tracker you use. If you want, update `Wok-O Taco/Wok-O Strategic Plans 2026/` with a note that Nick is live.
