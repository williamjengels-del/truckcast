# Testing Strategy

Three layers, each with a specific job:

## Layer 1 — Unit tests (vitest)

**Location:** `src/**/*.test.ts`
**Run:** `npm test` (or `npm run test:watch`)
**When it runs:** locally on demand, in CI on every PR + every push to main.

For pure logic: parsers, fee calculators, weather classifiers, forecast engine, signing primitives, middleware gate logic. Fast (<1s for the whole suite). No network, no Supabase, no browser.

**What belongs here:** anything you can test by calling a function with inputs and asserting outputs. If you'd need to stub network or DB to test it, that's a sign the code should be refactored to push I/O to the edges.

## Layer 2 — End-to-end (Playwright)

**Location:** `tests/e2e/*.spec.ts`
**Run:** `npm run test:e2e` (requires env — see [`tests/e2e/README.md`](./e2e/README.md))
**When it runs:** manual only. NOT in CI — needs admin credentials that don't belong in the repo.

For flows that cross the HTTP boundary and involve real auth: the impersonation mutation block, login happy-path (future), POS OAuth callback (future). Runs against a live deployment (prod by default) with real Supabase sessions.

**What belongs here:** anything that has to actually hit the network with real cookies to prove it works. Also anything where a unit test would require mocking enough that the mock could drift from reality.

## Layer 3 — Smoke (post-deploy HTTP)

**Location:** `scripts/smoke-test.mjs`
**Run:** `npm run smoke` (or `npm run check:full` = vitest + smoke)
**When it runs:** in CI automatically after every push to main (with 90s sleep waiting for Vercel to promote). `EXPECTED_COMMIT` is pinned to the pushed SHA so the smoke fails loud if it hits the old deployment.

For "is the deploy alive and doing what we think." Hits public endpoints with no auth — `/`, `/login`, `/roadmap`, `/contact`, `/api/version`, plus negative checks (`/api/feedback` POST unauth = 401, anonymous mutation = handler 401 not middleware 403, contact form honeypot returns ok without sending email). Runs in ~2 seconds.

**What belongs here:** external-side regression signal that doesn't require user auth. If Julian's password resets tomorrow, smoke still runs fine. Smoke is the last line of defense between a broken deploy and a customer hitting it.

## One command to run everything available without creds

```bash
npm run check       # typecheck + vitest (no network)
npm run check:full  # + smoke against prod
```

`check` is what to run before `git push` — matches the CI PR gate.
`check:full` is what to run when you want external deployment confidence too.

## What's NOT tested by automation

- UI visual regression. No Percy/Chromatic; visual changes are eyeballed.
- Accessibility beyond what lint catches (15+ known label-for issues on event form per v6 brief).
- Cross-browser. Playwright runs Chromium only.
- Mobile. PWA install + push notifications verified manually on iPhone 14 Pro Max per v6 brief.
- Third-party integrations. Stripe webhook handling isn't unit-tested; relies on Stripe's own test events and manual smoke.

## Operator diagnostics

Separate from tests — scripts that report prod state for humans:

- [`scripts/diagnose-stale-pos-syncs.mjs`](../scripts/diagnose-stale-pos-syncs.mjs) — flags POS connections whose last sync is older than N days. Would've caught the 2026-04 Toast Worker SPF silent data loss. Requires `SUPABASE_SERVICE_ROLE_KEY`.
- [`scripts/runbooks/`](../scripts/runbooks/) — step-by-step operator procedures (event purge, Nick reactivation, Julian's re-import). Not automation — checklists that keep the next run consistent with the last.

## Adding a new test

Decision flow:

1. Is it pure logic you can call with inputs? → vitest, next to the module.
2. Does it need real auth + HTTP + cookies? → Playwright in `tests/e2e/`.
3. Is it a "does the deploy still have X public surface available" check? → add to `scripts/smoke-test.mjs`.

If it doesn't fit any of those, it probably belongs in a runbook, not a test.
