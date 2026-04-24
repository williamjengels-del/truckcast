# Runbook — Toast unmatched-payment backfill

**Flagged in:** v10 addendum + v11 ("Historical Toast unmatched payment backfill. Pre-PR-14 Toast emails recorded `no_match` in `pos_connections.last_sync_error` but didn't insert into the inbox. One-time SQL can parse those rows and populate the inbox retroactively.").

**What it is:** a one-time SQL backfill that parses the most-recent no-match error message out of `pos_connections.last_sync_error` and writes the equivalent row into `unmatched_toast_payments`. Not auto-executed — preview first, backfill inside a transaction.

**Recoverable scope:** one row per Toast-connected user, at most. `pos_connections` is `UNIQUE(user_id, provider)` and `last_sync_error` is overwritten on every inbound email, so only the latest no-match per user is still there. Once that user has a subsequent successful inbound, the no-match evidence is gone. The bulk of pre-PR-14 no-matches have already been overwritten — don't expect a deep backfill.

**Why it's still worth doing:** gives each currently-affected user their one recoverable payment back in the inbox, and the runbook exists for the same pattern whenever a new provider gets wired through the same "overwrite the last status" shape.

---

## Inputs

None. The query is global — it scans every Toast `pos_connection` and only considers rows whose `last_sync_status = 'no_match'` and whose `last_sync_error` starts with `"No booked event on"` (the pre-PR-14 format).

---

## Step 1 — Preview (read-only, safe)

Open the Supabase SQL editor → + New query. Paste:

```sql
WITH parsed AS (
  SELECT
    pc.user_id,
    pc.last_sync_error AS raw_error,
    (regexp_match(pc.last_sync_error, 'No booked event on (\d{4}-\d{2}-\d{2})'))[1]::date
      AS reported_date,
    (regexp_match(pc.last_sync_error, 'Toast reported \$([0-9]+(?:\.[0-9]+)?)'))[1]::numeric
      AS net_sales
  FROM pos_connections pc
  WHERE pc.provider = 'toast'
    AND pc.last_sync_status = 'no_match'
    AND pc.last_sync_error LIKE 'No booked event on%'
)
SELECT
  parsed.user_id,
  p.business_name,
  parsed.reported_date,
  parsed.net_sales,
  parsed.raw_error,
  EXISTS (
    SELECT 1 FROM unmatched_toast_payments utp
    WHERE utp.user_id = parsed.user_id
      AND utp.reported_date = parsed.reported_date
      AND utp.net_sales = parsed.net_sales
  ) AS already_in_inbox
FROM parsed
LEFT JOIN profiles p ON p.id = parsed.user_id
WHERE parsed.reported_date IS NOT NULL
  AND parsed.net_sales IS NOT NULL
ORDER BY parsed.reported_date DESC;
```

Eyeball the results:
- **Zero rows** → nothing to backfill; runbook complete.
- **Rows with `already_in_inbox = true`** → already recovered; backfill will skip them (the Step 2 guard handles this).
- **Rows with NULL `reported_date` or `net_sales`** → regex couldn't parse the error text. If you see any, open the `raw_error` value and check what changed in the format. Don't proceed to Step 2 without understanding the parse failure.

---

## Step 2 — Backfill (inserts rows)

Wrapped in a transaction so you can `ROLLBACK` if the count surprises you. Idempotent via the `NOT EXISTS` guard — safe to re-run.

```sql
BEGIN;

WITH parsed AS (
  SELECT
    pc.user_id,
    (regexp_match(pc.last_sync_error, 'No booked event on (\d{4}-\d{2}-\d{2})'))[1]::date
      AS reported_date,
    (regexp_match(pc.last_sync_error, 'Toast reported \$([0-9]+(?:\.[0-9]+)?)'))[1]::numeric
      AS net_sales
  FROM pos_connections pc
  WHERE pc.provider = 'toast'
    AND pc.last_sync_status = 'no_match'
    AND pc.last_sync_error LIKE 'No booked event on%'
)
INSERT INTO unmatched_toast_payments (user_id, source, reported_date, net_sales, raw_subject)
SELECT
  parsed.user_id,
  'toast',
  parsed.reported_date,
  parsed.net_sales,
  '[backfilled 2026-04-24 from pos_connections.last_sync_error]'
FROM parsed
WHERE parsed.reported_date IS NOT NULL
  AND parsed.net_sales IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM unmatched_toast_payments utp
    WHERE utp.user_id = parsed.user_id
      AND utp.reported_date = parsed.reported_date
      AND utp.net_sales = parsed.net_sales
  )
RETURNING id, user_id, reported_date, net_sales;
```

If `RETURNING` shows the rows you expected from Step 1 (minus any `already_in_inbox = true` rows), commit:

```sql
COMMIT;
```

Otherwise:

```sql
ROLLBACK;
```

---

## After commit

- Affected users see the backfilled rows in their `/dashboard/integrations` amber Toast-unmatched inbox, labelled with `raw_subject = "[backfilled 2026-04-24 from pos_connections.last_sync_error]"` so they're distinguishable from live-captured rows.
- No cache invalidation or deploy required — the UI reads from the table directly.
- The admin triage view (if shipped) will surface the same rows across all users with the same label.

## What this runbook does NOT do

- Recover any no-match that predates the user's last sync attempt. The `pos_connections` row only holds the latest error.
- Recover any `ambiguous_match` rows. Those were never written to `last_sync_error` in a parseable format, and the root-cause UX question is "which of the multiple booked events on that date should have gotten the $?" — that's operator-intent, not auto-resolvable.
- Fix the underlying cause. PR #14 already did that for going-forward inbounds; this runbook is strictly rear-view.
