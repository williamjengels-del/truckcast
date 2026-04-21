# Runbook — Event Purge (test data cleanup before Nick reactivation)

**Flagged in:** `vendcast_session_brief_2026-04-19_v6.md` — purge all events except Julian's + Nick's, paused mid-session 2026-04-19.

**Why this runbook exists:** destructive prod DB operations need a checklist and a preview step, not a casually-pasted `DELETE`. Also written so the next session can execute without re-inventing the query from scratch.

**What it is:** a documented SQL procedure Julian (or a future Claude with DB access) runs in the Supabase SQL editor. The script is NOT auto-executed — the preview query runs first, numbers get eyeballed, the DELETE runs inside a transaction with `ROLLBACK` available.

---

## Inputs you need before running

| Var | Value / how to get it |
| --- | --- |
| `JULIAN_USER_ID` | `7f97040f-023d-4604-8b66-f5aa321c31de` (from `src/lib/admin.ts`) |
| `NICK_USER_ID` | Look up in Supabase Dashboard → Auth → Users → find Nick Baur → copy `id` |

Both must be real, non-null UUIDs before you run anything below. Paste them into the query's `IN (...)` list — do NOT leave placeholders.

---

## Step 1 — Preview (read-only, safe)

Paste into Supabase SQL editor. Replace the UUIDs.

```sql
-- How many events per user would be DELETED if we kept only Julian + Nick?
SELECT
  e.user_id,
  p.business_name,
  COUNT(*) AS events_to_delete
FROM events e
LEFT JOIN profiles p ON p.id = e.user_id
WHERE e.user_id NOT IN (
  '7f97040f-023d-4604-8b66-f5aa321c31de'::uuid,  -- Julian
  'PASTE-NICK-UUID-HERE'::uuid                   -- Nick
)
GROUP BY e.user_id, p.business_name
ORDER BY events_to_delete DESC;

-- Totals — one number to sanity-check
SELECT
  COUNT(*) FILTER (WHERE user_id IN (
    '7f97040f-023d-4604-8b66-f5aa321c31de'::uuid,
    'PASTE-NICK-UUID-HERE'::uuid
  )) AS events_kept,
  COUNT(*) FILTER (WHERE user_id NOT IN (
    '7f97040f-023d-4604-8b66-f5aa321c31de'::uuid,
    'PASTE-NICK-UUID-HERE'::uuid
  )) AS events_deleted,
  COUNT(*) AS total_before
FROM events;
```

**Gate before proceeding:**
- `events_kept` is non-zero (if it's 0, you've got the UUIDs wrong — STOP).
- `events_deleted` matches your expectation of how much test data exists.
- Per-user breakdown doesn't include any real customer you forgot about.

If any gate fails, stop and check the UUIDs. Don't run step 2.

---

## Step 2 — Purge (transactional, reversible until COMMIT)

**Only run after step 1's preview passed.** Same SQL editor, new query tab.

```sql
BEGIN;

DELETE FROM events
WHERE user_id NOT IN (
  '7f97040f-023d-4604-8b66-f5aa321c31de'::uuid,  -- Julian
  'PASTE-NICK-UUID-HERE'::uuid                   -- Nick
);

-- Supabase SQL editor shows the row count.
-- Verify it matches the events_deleted number from step 1.

-- If the count looks right:
COMMIT;

-- If ANYTHING looks off, even slightly:
-- ROLLBACK;
```

Paste the ENTIRE block above in one go — DO NOT run just the `DELETE` line. The transaction wrapper is the only reason this is recoverable.

Supabase's SQL editor runs each semicolon-separated statement individually, but inside a single query submission they share a transaction scope as long as you include the `BEGIN`/`COMMIT` yourself.

---

## Step 3 — Verify

```sql
-- Confirm only Julian + Nick remain
SELECT
  e.user_id,
  p.business_name,
  COUNT(*) AS events_remaining
FROM events e
LEFT JOIN profiles p ON p.id = e.user_id
GROUP BY e.user_id, p.business_name
ORDER BY events_remaining DESC;
```

Expected: exactly two rows (Julian + Nick), no others. If you see a third user, something didn't get deleted — check the UUID list and rerun step 2's DELETE (but NOT the whole thing — just the DELETE targeting whatever extra user_ids appear).

---

## Cascading cleanup (probably not needed)

`events.user_id` has `ON DELETE CASCADE` on `profiles(id)` — but we're deleting events, not profiles, so the cascade doesn't trigger here. If there are other tables with `event_id` foreign keys (e.g. attendance records, anomaly audits), check them separately:

```sql
-- See which tables reference events.id
SELECT
  tc.table_name,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON rc.unique_constraint_name = ccu.constraint_name
WHERE ccu.table_name = 'events'
  AND tc.constraint_type = 'FOREIGN KEY';
```

If that query returns rows, those tables need their own DELETE before step 2 (or a matching `ON DELETE CASCADE` if one's already configured — check the migration that created them).

---

## Rollback if things go wrong

- If you're still inside the transaction (haven't run `COMMIT`): `ROLLBACK;`
- If you've committed and need the data back: restore from the most recent Supabase PITR snapshot (Supabase Dashboard → Settings → Database → Point in Time Recovery). This is why timing matters — don't purge at 11 PM if you might want to undo at 2 AM.

**Baseline expectation:** take a snapshot right before running this (Supabase Dashboard → Settings → Database → Backups → Create manual backup). Belt-and-suspenders.
