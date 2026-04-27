# VendCast — Session Context Brief (v13)

**Date range:** April 27, 2026 (single working day, late afternoon → evening).
**Purpose:** Portable handoff. Supersedes v12.
**Status:** End of April 27. Brand-token rollout Phase 1 + 1.5 + 1.6/1.7 + 1.8 shipped to prod. Brad's design assets (logo + design notes) brought into the repo. Five April-24 PRs that had been sitting open got merged early in the session. Two PRs from April 24 still open (#26 dunning banner, #27 admin payment-failing filter) awaiting visual checks. Font question deferred to Brad — Adobe Fonts kit incoming.

---

## 1. What VendCast is

Unchanged from v12. Mobile-vendor ops platform; `"Built by a food truck operator. For mobile vendors."` is the locked subline. Founder-story guardrail unchanged. **Brand identity now coded:** Brad's two-color logo, deep teal (`#0d4f5c`) + saturated orange (`#e8621a`) brand tokens, full-bleed teal hero band — all live on vendcast.co.

---

## 2. Strategic verdicts — additions this session

Carrying v12's 21 verdicts forward. Two new ones:

22. **Brand tokens go in `globals.css`, brand-specific patterns layer on top.** The Phase 1 split — semantic role tokens (`--primary`, `--muted`) + named brand tokens (`--vendcast-teal`, `--vendcast-orange`) exposed as Tailwind utilities (`bg-brand-teal`, `text-brand-orange`) — is the discipline. Components reach for role tokens first; only marketing/branded surfaces reach for brand tokens directly. Any future palette swap is a single-file edit. See `docs/design-tokens.md`.

23. **Brad's design notes are repo-committed (`docs/brad-design-notes.md`).** Reasoning behind cuts/adds + outstanding "consider" items live in-repo so future Claude sessions read the rationale alongside the code. Avoids re-deriving design context across sessions.

---

## 3. Production state at session wrap

**Current live commit on main:** `639c0177` (PR #32 merge — Brad logo + hero padding tighten). PR #33 (numeric-emphasis brand-teal) **open, awaiting Julian's visual sign-off**, will likely merge tomorrow.

**Live on vendcast.co (this session):**
- Full-bleed teal hero band with white text + tightened `py-12` padding
- Brad's two-color "Vend|Cast" wordmark + truck illustration in nav (replaces lucide TruckIcon + text)
- Brand tokens (`--vendcast-teal`, `--vendcast-orange`) drive the diagonal tints + accent stripes on insight blocks
- Stripe `subscription.past_due` handler (PR #25)
- `/admin/users` no longer capped at 1000 rows (PR #23)
- Recharts `width(-1)` console warnings silenced (PR #24)
- Middleware test flake fixed for real (PR #22 — base64url padding bug, not vitest pool)
- `/api/chat` rate-limited at 20 msg/user/hour + Sentry-instrumented (PR #29)

**Known deferred (carried forward from v12, unchanged):**
- Chatbot disabled (`ANTHROPIC_API_KEY` missing from Vercel; runbook at `scripts/runbooks/chatbot-enablement.md`)
- Recharts width/height warnings outside admin (none flagged; PR #24 closed the only complaint)
- 15+ accessibility label fixes on event form
- `/api/team/invite` impersonation scope gap
- Rate limiter on `/api/contact` is in-memory
- $800 weather-loss copy/compute drift (Brad-deferred per Julian — needs brainstorm session, not a PR)
- Day-of-event design iteration (Julian to draw + share)

**New this session:**
- **Body-font choice deferred to Brad.** Brad will name his Adobe Fonts pick when home (April 27 evening or April 28). Implementation = Adobe Fonts kit setup (~10 min config) + `--font-sans` swap in `globals.css` (~10 min code). Geist remains the body font in the meantime.
- **Brad outstanding "consider" items** (from `docs/brad-design-notes.md`):
  - Monochrome Vend/Cast wordmark variant for small surfaces (favicons, email headers)
  - Orange-color-system disambiguation (currently doing 3 jobs: logo accent, chart color, CTA bg)
  - Both deferred per Brad's "your call" framing — they're his decisions to make.

---

## 4. Recent ships (April 27 single day, 9 PRs merged + 2 open)

Morning batch (cleanup of April 24 work that had sat open three days):
- **#22** fix(middleware/test) — tampered-signature flake
- **#23** fix(admin) — `/api/admin/users` 1000-row cap
- **#24** fix(dashboard) — Recharts `width(-1)` warnings
- **#25** feat(stripe) — `subscription.past_due` handler
- **#28** feat(profile) — custom slugs scaffold (stage 1; migration applied manually pre-merge)
- **#29** feat(chat) — rate limit + Sentry capture + enablement runbook

Afternoon brand rollout:
- **#30** feat(design) — Brad's brand tokens + homepage application (Phase 1)
- **#31** feat(home) — full-bleed teal hero band + OG copy mentions scheduling (Phase 1.5)
- **#32** feat(home) — real VendCast logo in nav + tighten hero padding + brad-design-notes committed (Phase 1.6/1.7)

Open at session wrap:
- **#26** feat(dashboard) — dunning banner on `/dashboard`. Awaiting visual eyeball.
- **#27** feat(admin) — admin payment-failing filter + badge on `/admin/users`. Awaiting visual eyeball.
- **#33** feat(home) — numeric-emphasis spans use brand-teal (Phase 1.8). Awaiting visual eyeball.

---

## 5. Next chat sequencing

### Immediate (operator-driven)
- Visual-check + merge **#26 #27 #33**.
- Brad sends Adobe Font name → ship Adobe Fonts kit + `--font-sans` swap (~20 min).
- Apply migration `20260424000003_add_profile_public_slug.sql` confirmed done; PR #28 already merged.

### Ready to pick up (unblocked)
- **`/pricing` page build** — Julian's three answers locked: monthly default + "save $X/yr" toggle, drop "most popular" badge (no subscribers yet), founder-story slot. ~200 lines, ~1.5 hours autonomous.
- **Phase 2 brand rollout** — apply tokens + logo to `/roadmap`, `/contact`, `/help`, `/follow`, `/book`, `/login`, `/signup`. Multi-PR sweep.
- **Dunning UI follow-ups** (post #26 merge): admin "payment failing" column on `/admin/users` (#27), `/api/team/invite` impersonation gap fix.
- **Toast unmatched backfill runbook** procedure (PR #17, already merged) — runbook lives in repo for future use.

### Blocked on operator input
- **Weather-drift / "learning" tier rethink** — needs Julian + Claude brainstorm session. Most events are "learning" tier which doesn't inspire confidence; underlying confidence framework needs revisit before any copy/compute fix on the homepage's Block 1.
- **Day-of-event design iteration** — Julian to sketch + share.
- **Brad's monochrome wordmark + orange-system disambiguation** — Brad's call.
- **Body font** — Adobe Fonts name from Brad.

### Queued (from v12, unchanged)
- Custom slugs stage 2-3 (slug picker UI on `/dashboard/settings`, public `/<slug>` page)
- Embeddable booking widget improvements
- 2FA + login notifications (Supabase TOTP)
- Nick reactivation (operator workflow, not code-gated)
- Tier-A chatbot enablement (needs ANTHROPIC_API_KEY on Vercel; runbook ready)
- Tier-B chatbot (data Q&A, tool-calling, several sessions)

---

## 6. Working notes — Julian and Claude

### Discipline patterns this session
- **Phase-numbered rollouts** keep multi-PR efforts navigable. Phase 1 (tokens), 1.5 (hero band), 1.6/1.7 (logo + padding), 1.8 (numeric emphasis) — each independently visual-checked, each independently mergeable.
- **Brand token discipline:** semantic role tokens (`--primary`) for components; named brand tokens (`--vendcast-teal`) only for marketing/branded surfaces. See `docs/design-tokens.md` "How to update tokens" section.
- **Decisions about color systems are designer-territory.** Orange is currently doing 3 jobs (logo accent, chart, CTA). Per Brad's notes, that's a system question for him, not Julian or Claude.
- **PNGs vs paste — direct paste of CSS / chat content beats screenshot upload** when the content is text. Screenshots take more time, more friction, more interpretation overhead.
- **Context-budget transparency works.** Julian asked "do you have enough context for option B?" Honest answer ("yes, with discipline, but A is safer") let him decide. Same pattern saved a botched mid-session crash.
- **Operator-perspective UX prompt** (drafted at session end, see prompt-archive.md if saved) — a Chat-Claude-targeted prompt for getting outside-eye review on the homepage + dashboard from a daily-operator-retention angle.

### Infrastructure state (carried forward from v12)

GitHub MCP, Cloudflare Observability MCP, Cloudflare Bindings MCP all operational. CI workflow runs typecheck + vitest on every PR; smoke post-deploy on every push to main. Manual SQL-paste pattern for migrations (Supabase Dashboard SQL Editor) is the standard.

### Julian's voice + preference markers (unchanged)
Direct pushback welcomed. Stamina-framing off-limits. Short replies often mean "got it, next." Humor + dry wit land well. Delegation posture: proceed autonomously within brief scope; confirm only for external-blast-radius actions.

---

## 7. Files / commits / branches

**Merged to main this session:** PRs #22, #23, #24, #25, #28, #29 (April 24 work) + #30, #31, #32 (Phase 1 brand rollout).

**Open branches at session wrap:**
- `feat/dunning-banner-2026-04-24` (PR #26 — open since Apr 24)
- `feat/admin-payment-failing-filter-2026-04-24` (PR #27 — open since Apr 24)
- `feat/numeric-emphasis-brand-teal-2026-04-27` (PR #33)
- `docs/session-brief-v13-2026-04-27` (this file)

**Key files modified this session:**
- `src/app/globals.css` — Brad's full token export + `--vendcast-teal` / `--vendcast-orange` exposed as Tailwind utilities
- `src/app/page.tsx` — full-bleed teal hero band, real logo image, tightened padding, numeric-emphasis brand-teal swap
- `src/app/opengraph-image.tsx` — brand colors + "event scheduling" in subline
- `public/vendcast-logo.jpg` — new, Brad's two-color wordmark + truck (89 KB)
- `docs/design-tokens.md` — new, source-of-truth reference + how-to-update runbook
- `docs/brad-design-notes.md` — new, Brad's design conversation committed

---

## 8. Success criteria status (updated)

| Criterion | Status |
|---|---|
| Brand identity coded (logo + tokens + hero band) | ✅ Live (PRs #30, #31, #32) |
| Body font matches Brad | ⏳ Awaiting Brad's Adobe Font name |
| Stripe past_due handler | ✅ Live (PR #25) |
| Admin caps lifted (`/admin/event-data` + `/admin/users`) | ✅ Live (PRs #21, #23) |
| Dunning banner on dashboard | ⏳ PR #26 open, visual check pending |
| Admin payment-failing surface | ⏳ PR #27 open, visual check pending |
| Custom-slugs DB foundation | ✅ Live (PR #28) |
| Chat rate-limited + observability | ✅ Live (PR #29); enablement still gated on env var |
| `/pricing` page | ❌ Queued (next session, unblocked) |
| Phase 2-5 brand rollout to other surfaces | ❌ Queued |
| Day-of-event design polish | ❌ Blocked on Julian's input |
| 2FA + login notifications | ❌ Queued |

---

## 9. How to resume in a new chat

### Opening message template

```
Continuing VendCast work. Attached is Session Brief v13 (handoff
from April 27 single-day session, supersedes v12).

Please read v13 fully — Section 3 (production state + open PRs),
Section 5 (next sequencing — three PRs pending visual + merge,
font swap pending Brad's Adobe Fonts name, /pricing page next-up).

Current state: Brad's brand identity is now live on vendcast.co
(logo, teal hero band, brand tokens). Three PRs from this session
+ two from Apr 24 still open. Five April-24 PRs merged this session.
Brad's design notes + token reference now committed to docs/.

Next Claude Code priorities depend on whether Julian merges the
open PRs first — visual-check #26, #27, #33 before starting new
work.

Confirm absorbed working style not just facts. Pick up from where
Julian signals.
```

### What's new since v12
- Phase 1 brand rollout: tokens + homepage hero band + logo + numeric-emphasis (5 PRs across 1, 1.5, 1.6, 1.7, 1.8)
- April 24 PR backlog cleared (5 PRs: middleware flake, admin users cap, recharts, past_due, chat rate limit)
- Brad's design notes + token export brought into the repo as committed docs
- Operator-UX-review prompt drafted for Chat Claude
- Verdict #22 (token discipline) and #23 (Brad notes in-repo) added

### Code-bubble discipline
Triple-backtick code blocks for Claude Code prompts. No conversational framing mixed in.

---

*End of brief v13.*
