# VendCast

SaaS operations platform for mobile vendors — food trucks, trailers, carts, coffee carts, pop-up retail, any mobile vendor. Inquiry intake, booking management, calendar, POS-synced sales tracking, and weather-aware revenue forecasting in one place.

Live at **[vendcast.co](https://vendcast.co)**.

---

## Status

See `vendcast_session_brief_YYYY-MM-DD_vN.md` in the top-level `../Briefs/` folder (sibling of this repo) for current state, open workstreams, and session handoff notes. Latest brief = latest session state. Older briefs are history, not current.

`/api/version` reports the currently-deployed commit: `curl -s https://vendcast.co/api/version`.

---

## Tech stack

- **Framework:** Next.js 16 (App Router, proxy-based middleware)
- **DB:** Supabase (PostgreSQL + RLS + Auth)
- **Billing:** Stripe (Starter / Pro / Premium, monthly + annual)
- **Weather:** Open-Meteo
- **Email:** Resend (outbound), Cloudflare Email Routing (inbound → forwarding)
- **Hosting:** Vercel
- **Styling:** Tailwind CSS + shadcn
- **Observability:** Sentry

Note: per `AGENTS.md`, Next.js 16 has API/convention differences from older training data — check `node_modules/next/dist/docs/` before writing Next.js-specific code.

---

## Local development

```bash
# First-time setup
npm install
cp .env.local.example .env.local    # fill in values

# Run the dev server
npm run dev                          # http://localhost:3000
```

Required env vars for local dev (see [.env.local.example](.env.local.example)):
- Supabase URL + anon key + service role key
- Stripe keys + price IDs
- Resend API key
- `IMPERSONATION_SIGNING_SECRET` (any 32+ char string locally; must match prod only on prod)
- Optional: `ANTHROPIC_API_KEY` for chatbot (gated off if unset)

---

## Testing

Three layers — see [tests/README.md](tests/README.md) for the full strategy.

```bash
npm run check           # typecheck + vitest (what CI runs on PRs)
npm run check:full      # + smoke against https://vendcast.co
npm run test:e2e        # Playwright, requires creds — see tests/e2e/README.md
npm run smoke           # post-deploy HTTP smoke alone
```

CI runs `npm run check` on every PR (blocking) and smoke post-deploy on every push to main. The feedback loop is ~2 min from push to "deploy verified."

---

## Operator runbooks

Step-by-step procedures for recurring operational tasks:

- [scripts/runbooks/event-purge.md](scripts/runbooks/event-purge.md) — SQL-level cleanup of test events before onboarding a new user.
- [scripts/runbooks/julian-re-import.md](scripts/runbooks/julian-re-import.md) — re-importing cleaned Airtable history via the CSV flow.
- [scripts/runbooks/nick-reactivation.md](scripts/runbooks/nick-reactivation.md) — end-to-end reactivation workflow: admin CSV import → impersonation QA → anomaly fixes → customer handoff.

## Operator diagnostics

Read-only scripts that surface prod state:

- [scripts/diagnose-stale-pos-syncs.mjs](scripts/diagnose-stale-pos-syncs.mjs) — flags POS connections with stale `last_sync_at`. Runs weekly in CI; manual runs take ~2 seconds with `SUPABASE_SERVICE_ROLE_KEY` exported.

---

## Architecture notes

- **Row-level security on every table.** Every query is scoped to `auth.uid()`. Service-role client is admin-only (`src/lib/admin.ts` allowlist by user_id, not email).
- **Admin impersonation is read-only.** Signed 30-minute cookie, HMAC-SHA256. Middleware blocks all mutations under an active cookie except `/api/admin/*` (so admin tools + "stop impersonation" keep working). Regression-tested in `src/lib/supabase/middleware.test.ts` and `tests/e2e/`.
- **POS integration.** Square/Clover/SumUp via OAuth. Toast via email forwarding (Cloudflare Worker → `/api/pos/toast/inbound`). The Worker repo is separate from this one.
- **Forecast engine is server-side** with hierarchical fallback (4 levels), network-enhanced once multiple operators have overlapping event history.
- **Deploy reliability is Priority Zero.** `/api/version` returns the deployed commit within ~2 min of push. Smoke runs automatically after every deploy.

---

## Project layout

```
src/
  app/                   # Next.js App Router pages + API routes
    api/
      admin/             # Admin-only — impersonate, users, events, testimonials
      pos/               # POS OAuth + sync endpoints (Square, Clover, Toast, SumUp)
      contact/           # Public contact form submission
      version/           # Deploy identity probe
    dashboard/           # Authenticated user surface
  lib/
    admin.ts             # Admin allowlist
    admin-impersonation.ts  # Signed cookie + verify
    supabase/
      middleware.ts      # updateSession — auth, trial gate, impersonation block
      server.ts          # SSR Supabase client
      client.ts          # Browser Supabase client
    pos/                 # POS provider adapters
    csv-import/          # CSV parser (papaparse-backed)
    forecast-engine/     # Forecasting logic
  proxy.ts               # Next 16 proxy entry (formerly middleware.ts)

supabase/migrations/     # DB schema
scripts/
  smoke-test.mjs         # Post-deploy HTTP smoke
  diagnose-stale-pos-syncs.mjs  # Operator diagnostic
  runbooks/              # Operator procedures
tests/
  e2e/                   # Playwright impersonation regression suite
  README.md              # Testing strategy

.github/workflows/
  deploy.yml             # Vercel deploy on push to main
  ci.yml                 # PR gate + post-deploy smoke
  stale-pos-syncs.yml    # Weekly stale-sync diagnostic
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Branch / commit conventions
- How to run the testing stack locally
- When to add a vitest vs Playwright vs smoke test
- Session brief template for multi-session work

Built and maintained by Julian Engels. VendCast LLC is a Missouri single-member LLC, separate from Concourse Foods LC (the Wok-O Taco legal entity).
