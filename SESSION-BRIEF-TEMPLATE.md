# VendCast — Session Context Brief (vN)

<!--
Template for a VendCast session brief. Copy this file to
`vendcast_session_brief_YYYY-MM-DD_vN.md` at repo root and fill in.

Purpose: one self-contained document that lets the NEXT Claude session
pick up cold — no need to re-read five prior briefs. Brief should be
readable end-to-end in ~3 minutes.

Match the voice of existing briefs: direct, operator-fluent, no
marketing language, no apologies. Past tense for ships, present tense
for decisions, explicit dates for anything time-bound.

Delete these HTML comments before committing.
-->

**Date range:** <!-- e.g. April 22–24, 2026 -->
**Purpose:** Portable handoff document for resuming VendCast work. Supersedes v(N-1).
**Status:** <!-- One sentence. What shipped this session, what's in progress, what's blocked. -->

---

## 1. What VendCast is

<!-- Keep this stable across briefs. Copy the Section 1 paragraph from
v6 unless the product scope actually changed. If it changed, mark the
change explicitly: "As of 2026-MM-DD, the strategic framing shifted from
X to Y because..." -->

---

## 2. Strategic verdicts (locked)

<!-- Numbered list. Each item is a decision that doesn't get re-opened
unless explicitly revisited. These compound — add new verdicts as
they're decided, don't remove old ones unless reversed. -->

1. (from prior briefs)
2. (new this session, if any)

---

## 3. Production state at session wrap

**Current live commit:** `<sha>` — `<commit title>`

**Verified in production this session:**
- <!-- Things smoke/Playwright/manual testing confirmed live. Each
bullet should be a specific claim about deployed behavior, not a
description of the code. -->

**Known deferred issues:**
- <!-- Bug or gap that exists on prod and is NOT being fixed this
session. Include: what's broken, what the impact is, why it's deferred,
who owns the fix. -->

---

## 4. Recent ships (this session)

<!-- Commit-indexed. Format:
**`<sha>`** — <one-line summary>.
<1-2 sentences on what this actually changed for users or operators.
Not "what code changed" — "what someone can now do that they couldn't." -->

---

## 5. Next chat's sequencing

### In progress (paused for session end)

<!-- What's partially done. Include enough context that the next Claude
can pick up without re-deriving. If a SQL query is half-written, paste
it. If a branch is uncommitted, name it. -->

### Blocked on external factor

<!-- What's waiting on Julian's audit, a third party, a decision, a
legal signoff. Each blocker should say what unblocks it. -->

### Queued

<!-- Ordered list of what to do next once unblocked. Specific, not
vague. "Implement 2FA via Supabase TOTP" not "auth improvements." -->

### Minor cleanup (deferred)

<!-- Stuff that's real but small enough to defer without a meeting.
Running list. Graduates to "Queued" when it gets prioritized or
"Blocked" when it surfaces as urgent. -->

---

## 6. Working style notes

<!-- Only update if Julian's collaboration preferences shifted. Don't
repeat what's in CLAUDE.md or auto-memory. Examples of what belongs
here:
- "This session we tried running Playwright against preview; creds-via-
  tee approach worked well, keep using it"
- "Julian wants runbook docs for anything he'll do twice — not one-offs"
- "Defer to test-infra-only lane unless he says otherwise in session"
-->

---

## 7. Files / commits / branches touched

<!-- Inventory. Not prose. -->

- Branches merged this session:
- Branches open as PRs:
- Branches abandoned:
- Files with notable changes: <!-- path + 1-line why -->

---

## 8. Success criteria status

<!-- Checklist of what "done" looks like for the current phase. Copy
from the prior brief, update the status column. Add rows for new
criteria introduced this session. -->

| Criterion | Status |
|---|---|
| (from prior brief) | ✅ / ❌ / ⏳ |

---

## 9. How to resume in a new chat

### Opening message template

```
Continuing VendCast work. Attached is Session Brief v<N>.

Please read it fully — particularly Sections 3 (production state),
5 (next sequencing), and any workstream-specific section I flag in
this message.

Current state: <one sentence — what's paused, what's next, any
blocker that's become resolved since the brief was written>.

Confirm you've absorbed the working style not just the facts. Ready
to pick up from wherever I signal.
```

### What NOT to ask Claude in the opening message

<!-- Things the brief answers. Asking wastes a turn and context. -->
- Don't ask it to summarize the brief — it'll pad with fluff
- Don't ask "where are we" — Section 3 + Section 5 already cover that
- Don't ask "what should I do next" without first sharing which
  section of Section 5 is unblocked

---

<!-- End of template. Append any workstream-specific sections below
(Section 10, 11, 12...) as needed. Use them for things like:
- "Section 11: Event purge + Nick reactivation sequencing" (v6 had this)
- "Section 10: Cloudflare Email Routing current state" (v6 had this)
Anything that has enough depth to warrant its own heading and would
otherwise bloat Section 5. -->
