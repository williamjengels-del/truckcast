# Contributing

For now this is a solo project (Julian + Claude sessions). This doc exists so future Claude sessions — and any future human collaborator — can pick up cold without re-inferring conventions from scattered config files.

If you're starting a new Claude session, also load the latest `vendcast_session_brief_YYYY-MM-DD_vN.md` at the repo root. Use [SESSION-BRIEF-TEMPLATE.md](SESSION-BRIEF-TEMPLATE.md) when writing the next one.

---

## Branch + commit conventions

### Branches

- `main` — always deployable. Protected in spirit (branch protection rules not enforced yet, but CI gates every PR).
- Feature branches: short kebab-case with a prefix.
  - `test/...` — test infrastructure, runbooks, operator tooling (no app code changes)
  - `feat/...` — new user-facing functionality
  - `fix/...` — bug fixes
  - `refactor/...` — non-functional code reshaping
  - `docs/...` — README, runbooks, briefs
  - `chore/...` — deps, tooling, CI that isn't a test
- Delete branches after merging. They live on as merge commits.

### Commits

Conventional-commit style header, present tense, no trailing period:

```
<type>(<scope>): <summary ≤72 chars>
<blank>
<body — why, not what. Reference the brief if relevant.>

Co-Authored-By: <name> <email>
```

Types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`, `ops`.

Example:
```
test(e2e): Playwright suite for impersonation mutation guard

Closes the gap flagged in vendcast_session_brief_2026-04-21_impersonation-block.md.
Covers the live HTTP path; vitest covers the gate logic in isolation.
```

Commits don't have to be one-per-logical-change, but PR titles should describe the cohesive unit of work.

---

## Pull requests

### Size

Small PRs merge fast. Large PRs sit. Aim for one concern per PR — don't bundle "add new feature + refactor the thing near it + fix unrelated typo." When you catch yourself bundling, split.

### Required

- Passes `npm run check` (typecheck + vitest) — CI enforces this.
- No new test failures in the suite you touched.
- Commits attributed (Co-Authored-By) if written by Claude.

### Nice-to-have

- Smoke runs green after merge (CI checks this post-deploy).
- A line in the PR description linking to the session brief or runbook this came from, if applicable.
- If the PR is infrastructure that benefits from a visual check, include a screenshot or the shell output of the before/after.

### Merging

- **Do not force-push to `main`.** Ever. Force-push on feature branches is fine.
- Regular merge commits are fine. Squash merges are fine. Pick what reads cleaner in `git log`.
- Delete the branch on merge (GitHub UI has the button).

---

## Testing — what goes where

Full strategy in [tests/README.md](tests/README.md). Short version:

- **Pure logic** → vitest, colocated with the module (`foo.ts` + `foo.test.ts`)
- **Real-auth HTTP flow** → Playwright in `tests/e2e/`
- **Post-deploy public surface** → add a check to `scripts/smoke-test.mjs`

If it doesn't fit any of those, it probably belongs in a runbook, not a test.

### Before pushing

```bash
npm run check       # ~7.5s, mirrors the CI PR gate exactly
```

If that passes, your PR will pass CI. If it fails locally, it'll fail in CI — save yourself the round trip.

For external deploy confidence when working on something that touches the prod-facing surface:

```bash
npm run check:full  # + smoke against https://vendcast.co
```

---

## What NOT to do

- **Don't edit app code in a `test/...` branch.** If the lane is test infrastructure, stay in it. Surface app-code issues you notice (in the PR description or a session brief) but don't bundle fixes.
- **Don't skip CI hooks (`--no-verify`, `--no-gpg-sign`).** If CI fails, fix the root cause.
- **Don't commit `.env.local`.** `.env.local.example` is the template; real values go in the gitignored file.
- **Don't introduce features or abstractions beyond what the task requires.** YAGNI. Three similar lines > premature abstraction.
- **Don't add comments that explain WHAT code does.** Only comments that explain WHY (hidden invariant, past incident, workaround for external bug).
- **Don't run destructive prod operations (DROP, DELETE on unscoped tables, Stripe refunds, Supabase PITR restore) without a runbook + an explicit approval.** Write the query, document it in `scripts/runbooks/`, then ask before pressing go.

---

## Session briefs

Long-running workstreams span multiple Claude sessions. The briefs at repo root are the persistence layer. Each session should:

1. Read the most recent brief before starting (gives context in ~3 min).
2. Update the brief (or write a new versioned one) at session end.
3. Commit the brief with a `docs(brief):` prefix.

The [SESSION-BRIEF-TEMPLATE.md](SESSION-BRIEF-TEMPLATE.md) has the structure and guidance on each section. Copy it, don't type freeform — consistency compounds.

---

## Auto-memory (Claude sessions)

Claude's auto-memory at `~/.claude/projects/C--Users-wjeng-Desktop-Projects-w-Claude/memory/` holds durable user preferences, project state that can't be derived from code, and references to external systems. New session starts? Auto-memory loads automatically. Don't duplicate what's in a session brief into memory — session briefs are for session-scoped work, memory is for facts that persist across sessions.

---

## Getting help

- Architectural questions → check the latest session brief's Section 2 (strategic verdicts) first.
- "How do I run X" → this file or [tests/README.md](tests/README.md).
- Bug in prod → run `node scripts/diagnose-stale-pos-syncs.mjs` first if POS-related; otherwise check `/api/version` to confirm the deployed commit matches expectations.
