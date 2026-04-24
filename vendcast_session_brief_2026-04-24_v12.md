# VendCast — Session Context Brief (v12)

**Date range:** April 24, 2026 (afternoon).
**Purpose:** Portable handoff. Supersedes v11.
**Status:** End of April 24. Homepage rebuild merged to prod. Three additional PRs open covering Toast unmatched backfill runbook, admin Toast triage view, and Stripe invoice webhook handlers. Julian delegated all three workstreams autonomously while away.

---

## 1. What VendCast is

Unchanged from v11. Mobile-vendor ops platform; `"Built by a food truck operator. For mobile vendors."` is the locked subline. Founder-story guardrail unchanged (OG pill badge + "Built by a Food Truck Owner" language specifically stays narrow). Entity separation (VendCast LLC / Concourse Foods LC / Wok-O Taco LLC) carried forward — Rudy's 30.5% equity in Concourse isn't a VendCast constraint.

---

## 2. Strategic verdicts — additions this session

Carrying v11's 20 verdicts forward. One new:

21. **Autonomous-to-PR-open is the working mode when Julian's away.** Prior autonomous passes stopped at "review-ready, uncommitted." This afternoon Julian explicitly delegated commit + push + PR open for three workstreams in a row, trusting the per-PR check/build gates + operator-driven review/merge. The mode composes: Claude Code ships branches + PRs + notes, Julian merges on his own cadence. Discipline preserved: one PR per concern, each independently `npm run check`-green, clear migration-before-merge callouts in PR bodies where applicable.

---

## 3. Production state at session wrap

**Current live commit on main:** `dd1f427` (PR #16 merge — homepage rebuild). Verified on vendcast.co via `/api/version` within 90s of merge.

**Live on homepage (resolved real data, verified plausible):**
- Rain/Hot/Cold impact percentages: 47 / 37 / 45% (derived from `WEATHER_COEFFICIENTS`)
- Weather-loss dollars: live-queried from Julian's `events.net_sales` × (1 − Storms), snapped to nearest $50
- Repeat-booking decline rate: live cross-year aggregate from Julian's data, ~65%, Julian confirmed plausible

**Open PRs at session wrap:**

- **PR #17 — ops(runbook): Toast unmatched-payment backfill SQL procedure**
  Branch: `feat/toast-backfill-runbook-2026-04-24`
  Commit: `99510b4`
  Runbook-only (docs). Step 1 preview SQL executed in prod by Julian — returned zero rows (expected, recoverable scope is at-most-one-row-per-user and overwrites on each inbound). Merge anytime; doc-only.

- **PR #18 — feat(admin): Toast unmatched-payment triage view across all users**
  Branch: `feat/admin-toast-inbox-triage-2026-04-24`
  Commit: `5cbe61d`
  New admin page at `/dashboard/admin/toast-inbox`. Read-only (resolve stays with operator intent). `npm run check` green. Not yet visually verified on Vercel preview.

- **PR #19 — feat(stripe): invoice.payment_succeeded + invoice.payment_failed webhooks (dunning prep)**
  Branch: `feat/stripe-invoice-webhooks-2026-04-24`
  Commit: `b586e02`
  Adds two handlers to the existing webhook route + a migration `20260424000002_add_billing_payment_tracking.sql` adding `last_payment_at / last_payment_status / last_payment_failure_reason` to `profiles`. Sentry captures payment_failed events as warnings. **Migration must be applied manually in Supabase SQL Editor BEFORE merging** — the PR body has the one-paste procedure.

**Closed this session:**
- **PR #16 — homepage rebuild.** Merged `dd1f427`. Serving vendcast.co.

**Known deferred (carried forward from v11):**
- Chatbot disabled (`ANTHROPIC_API_KEY` missing from Vercel)
- Recharts width/height warnings
- 15+ accessibility label fixes on event form
- `/api/team/invite` impersonation scope gap
- Rate limiter on `/api/contact` is in-memory
- Middleware test flake (tampered cookie spec, intermittent)
- Day-of-event design iteration — Julian has input, not yet captured or committed
- $800 weather-loss semantic drift (Block 1 copy vs Storms-specific computation)
- Real `/pricing` page (elevated priority since homepage `/pricing` now redirects to `/`)
- Brand-palette reconciliation with Brad's Figma teal/orange (needs Brad input)

**New deferred this session:**
- **Dunning UI** — PR #19 lands the DB state + handlers; no user-facing banner, no admin triage column yet. Follow-ups explicit in the PR body.
- **`past_due` handler** inside `customer.subscription.updated` (Stripe emits it after N failed retries). Not in PR #19; separate follow-up.
- **Admin triage "resolve on behalf of user"** — PR #18 is deliberately read-only. Resolving requires operator-intent (deposit vs remainder vs dismiss), which belongs in impersonation, not admin triage.

---

## 4. Recent ships (April 24 afternoon)

One merge, three PRs opened:

| PR | Title | Branch | Status |
|---|---|---|---|
| #16 | feat(home): rebuild landing page with insight blocks + real-data resolutions | `homepage-rebuild-2026-04-24` | **Merged** `dd1f427` |
| #17 | ops(runbook): Toast unmatched-payment backfill SQL procedure | `feat/toast-backfill-runbook-2026-04-24` | Open |
| #18 | feat(admin): Toast unmatched-payment triage view across all users | `feat/admin-toast-inbox-triage-2026-04-24` | Open |
| #19 | feat(stripe): invoice.payment_succeeded + invoice.payment_failed webhooks (dunning prep) | `feat/stripe-invoice-webhooks-2026-04-24` | Open, migration-before-merge |

---

## 5. Next chat sequencing

### Immediate (operator-driven)

- **Apply migration `20260424000002`** in Supabase SQL Editor before merging PR #19. One paste; idempotent. Verification query in the PR body.
- Merge PR #17 (runbook-only, no risk).
- Visual-check PR #18 preview → merge.
- Merge PR #19 after migration is applied.

### Ready to pick up (unblocked)

- **Real `/pricing` page** — still elevated priority after homepage rebuild's `/pricing → /` temporary redirect.
- **Dunning UI** — banner on `/dashboard` when `last_payment_status = 'payment_failed'` linking to Stripe customer portal. Depends on PR #19 merge + migration.
- **Admin triage "payment failing" filter** — adds a column to `/dashboard/admin/users` using the partial index from PR #19's migration.
- **`past_due` handler** inside the subscription.updated branch.
- **$800 weather-loss copy/compute alignment** — XS, needs directional call from Julian.
- **65% repeat-booking decline verification** — already closed in conversation; can delete from queue.
- **Middleware test flake fix** — `poolOptions.forks: { singleFork: true }`, ~15 min.
- **Day-of-event design iteration** — still blocked on Julian's unshared input.

### Queued (from v11, unchanged)

- Custom slugs + public vendor profiles
- Embeddable booking widget improvements
- 2FA + login notifications (Supabase TOTP)
- Nick reactivation (operator workflow, not code-gated)
- Tier-A / Tier-B chatbot

### Minor cleanup (deferred)

- 13 pre-existing lint errors on main
- Full extraction of remaining nested components in events-client.tsx
- Timezone audit beyond admin activity

---

## 6. Working notes — Julian and Claude

### Discipline patterns this session

- **One PR per concern, merge independently.** Three workstreams → three branches cut from main in sequence, each with a single focused commit, each independently `npm run check`-green. Clean mergeability even if one PR needs revision.
- **Migration-before-merge is a PR-body contract.** When a PR depends on a migration, say so in the summary + test plan before the "Merge" button is available. v10 pattern; re-used here for PR #19.
- **Admin-gated read-only surfaces compose.** PR #18's admin triage view mirrors the existing `/api/admin/users` pattern one-to-one (service role client + `getAdminUser()` gate + `in()`-batched profile/auth joins). Consistency > novelty for admin plumbing.
- **Short Julian responses in the delegation window mean "proceed."** "Just do what you can" + "s fine" were explicit unblock phrases; Claude Code moved through all three PRs without stopping for each commit + push + PR-open.
- **Scratch → PR transition: stash-restore-branch pattern** kept three different workstreams' changes separate when they all lived on the same dirty working tree. Each branch cut from main with only its own files; session briefs + Captures + `.claude-scratch/` left as untracked across branches.

### Infrastructure state

No change from v11. GitHub MCP, Cloudflare Observability MCP, Cloudflare Bindings MCP all operational. CI workflow runs typecheck + vitest on every PR; smoke post-deploy on every push to main.

### Julian's voice + preference markers (unchanged)

Direct pushback welcomed. Stamina-framing off-limits. Short replies often mean "got it, next." Humor + dry wit land well. Delegation posture: proceed autonomously within brief scope; confirm only for external-blast-radius actions.

---

## 7. Files / commits / branches

**Merged to main this session:** PR #16 (homepage rebuild), commit `dd1f427`.

**Open branches at session wrap:**
- `feat/toast-backfill-runbook-2026-04-24` (PR #17, `99510b4`)
- `feat/admin-toast-inbox-triage-2026-04-24` (PR #18, `5cbe61d`)
- `feat/stripe-invoice-webhooks-2026-04-24` (PR #19, `b586e02`)
- `docs/session-brief-v12-2026-04-24` (this file)

**Key files modified this session:**
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/opengraph-image.tsx`, `next.config.ts` — homepage rebuild (shipped)
- `playwright.homepage.config.ts`, `tests/e2e/homepage-rebuild.spec.ts` — new Playwright config + spec (shipped)
- `scripts/runbooks/toast-unmatched-backfill.md` — new runbook (PR #17)
- `src/app/api/admin/toast-unmatched/route.ts` — new admin-gated API (PR #18)
- `src/app/dashboard/admin/toast-inbox/page.tsx` + `toast-inbox-client.tsx` — new admin triage page (PR #18)
- `src/app/dashboard/admin/admin-tabs.tsx` — "Toast Inbox" tab added (PR #18)
- `supabase/migrations/20260424000002_add_billing_payment_tracking.sql` — new migration (PR #19)
- `src/app/api/stripe/webhook/route.ts` — two new handlers + Sentry capture (PR #19)

---

## 8. Success criteria status (updated)

| Criterion | Status |
|---|---|
| Homepage rebuild (content + structure) | ✅ (merged `dd1f427`) |
| Stripe invoice event handling (dunning prep) | ⏳ (PR #19 open, awaiting migration + merge) |
| Admin triage view for Toast inbox | ⏳ (PR #18 open) |
| Toast unmatched backfill procedure documented | ⏳ (PR #17 open, runbook-only) |
| Nick active on VendCast | ❌ Operator workflow pending |
| Real `/pricing` page | ❌ Queued (elevated) |
| 2FA + login notifications | ❌ Queued |
| Directory indexed + organic traffic | ❌ Oct-2026 target |

---

## 9. How to resume in a new chat

### Opening message template

```
Continuing VendCast work. Attached is Session Brief v12 (handoff
from April 24 afternoon, supersedes v11).

Please read v12 fully — Section 3 (production + open PRs), Section 5
(next sequencing — three PRs pending merge, one of them needs a
migration applied first), Section 2 (verdict 21: autonomous-to-PR-open
mode).

Current state: homepage rebuild is live. Three PRs open from this
afternoon's autonomous run: runbook (#17), admin Toast triage (#18),
Stripe invoice webhooks (#19). Before merging #19, apply migration
20260424000002 via Supabase SQL Editor — PR body has the procedure.

Confirm absorbed working style not just facts. Pick up from where
Julian signals.
```

### What's new since v11

- Homepage rebuild merged + live.
- Three new PRs from autonomous afternoon delegation.
- Autonomous-to-PR-open mode captured as verdict #21.
- Dunning-prep DB state + Sentry capture wiring added (PR #19).
- First cross-user admin triage surface live (PR #18) — template for future admin views.

### Code-bubble discipline

Triple-backtick code blocks for Claude Code prompts. No conversational framing mixed in.

---

*End of brief v12.*
