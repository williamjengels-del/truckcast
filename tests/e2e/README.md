# Impersonation Playwright Suite

End-to-end regression tests for the "impersonation blocks mutation" guard in
[`src/lib/supabase/middleware.ts:54-135`](../../src/lib/supabase/middleware.ts)
(invoked from the Next 16 proxy in [`src/proxy.ts`](../../src/proxy.ts)).

## Background

A 2026-04-21 investigation (see `vendcast_session_brief_2026-04-21_impersonation-block.md`
at the repo root) confirmed the guard works correctly in local dev, Vercel
preview, and production. The original smoke-test report of a bypass could not
be reproduced. This suite exists as **regression protection** so that future
refactors (e.g. any follow-on to the `middleware.ts` → `proxy.ts` migration)
can't silently break the block.

The unit side of that coverage — a vitest test that constructs a `NextRequest`
with a valid cookie and asserts `updateSession` returns 403 — is still an open
gap flagged by that same brief. This Playwright suite covers the live HTTP
path; a vitest test would additionally cover the gate logic in isolation.

## What these tests do

1. `global-setup.ts` — logs in as the admin once via `/login` and persists
   cookies to `.auth/admin.storageState.json`.
2. `impersonation-blocks-mutation.spec.ts` — for each of the four user-scoped
   mutation endpoints (Square sync, Toast sync, Clover sync, Team invite),
   starts impersonation and asserts the endpoint returns **403** with header
   `x-impersonation-blocked: 1` and body
   `{ error: "Read-only impersonation active" }`.
3. `impersonation-admin-routes.spec.ts` — asserts admin-scoped routes
   (`/api/admin/users`, `/api/admin/impersonate/stop`) are NOT blocked by the
   middleware under impersonation. Includes a scaffolded `test.skip` for a
   future admin mutation route.
4. `impersonation-ui-flow.spec.ts` — browser-level smoke: impersonate, click
   the "Sync now" button on `/dashboard/integrations`, assert the network
   response is the middleware 403. Auto-skips if `TARGET_USER_ID` has no
   connected POS provider.

## Running the suite

### 1. Install browsers (first run only)

```bash
npm run test:e2e:install
```

### 2. Set env vars

Create `tests/e2e/.env.e2e` (gitignored) or export these in your shell:

| Var | What it is |
| --- | --- |
| `PLAYWRIGHT_BASE_URL` | Preview or prod URL (e.g. `https://vendcast-git-<branch>-<hash>.vercel.app`) or `http://localhost:3000`. |
| `ADMIN_EMAIL` | Email of an account in the admin allowlist (see `src/lib/admin.ts`). |
| `ADMIN_PASSWORD` | That account's password. |
| `TARGET_USER_ID` | Supabase `auth.users.id` (uuid) of a non-admin test user to impersonate. For the UI flow test to run instead of skip, this user should have at least one POS provider connected. |

Preview-scope note from the 2026-04-21 session: make sure the Vercel Preview
env has `NEXT_PUBLIC_SUPABASE_ANON_KEY` set. Without it the login step in
global-setup will hang or fail with a Supabase client error.

### 3. Run

```bash
# Against a deployed preview:
PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
ADMIN_EMAIL=... ADMIN_PASSWORD=... TARGET_USER_ID=... \
npm run test:e2e

# Against local dev (requires `npm run dev` in another terminal):
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
ADMIN_EMAIL=... ADMIN_PASSWORD=... TARGET_USER_ID=... \
npm run test:e2e
```

Local dev needs `IMPERSONATION_SIGNING_SECRET` set in `.env.local` (any 32+
char string works — doesn't need to match prod).

### 4. Specific specs

```bash
npx playwright test impersonation-blocks-mutation
npx playwright test impersonation-admin-routes
npx playwright test impersonation-ui-flow
```

## Interpreting failures

- **2xx received on a `BLOCKED_ENDPOINTS` row** — the middleware guard did not
  fire for that route. This is the shape of the bug that was investigated on
  2026-04-21; if it resurfaces, the guard has regressed. Check `proxy.ts`
  matcher, cookie verification, and method detection.
- **403 with `x-impersonation-blocked` missing** — a different gate produced
  the 403 (subscription tier, admin check). The middleware runs first in
  `updateSession`, so this should not occur in practice. If you see it,
  middleware order is broken.
- **403 on an admin route** (`impersonation-admin-routes.spec.ts` fails) —
  the middleware is over-blocking `/api/admin/*` and admins will get stuck
  in read-only mode. Fix the exempt-path check.
- **Setup fails on `/login`** — the login selectors drifted. Update
  `global-setup.ts`.

## Side-effect notes

- **Team invite**: the invite test hits `/api/team/invite` with an
  `@example.invalid` recipient. When the guard is working (the expected
  case) the request 403s before the handler runs and no email is sent. If
  the guard ever regresses to let the handler run, the `.invalid` TLD is
  RFC 6761 non-deliverable so no human receives mail — but the Resend API
  call will still be attempted and may consume quota / emit a bounce log.
- **POS syncs**: same logic applies — 403 happens upstream of any POS API
  call. A regression would mean the sync job runs for `TARGET_USER_ID`, so
  use a dedicated test user, not a real customer account.

## What's NOT tested here

- Expired / forged / tampered `vc_impersonate` cookie → the gate should
  treat it as no-cookie and let the route execute normally. Candidate for
  an additional spec; would require access to `IMPERSONATION_SIGNING_SECRET`
  to construct a cookie with past expiry.
- The "no-impersonation baseline" — e.g. an unauth'd POST to a mutation
  route returns 401 from the route handler, not the middleware. Would
  catch over-blocking regressions. Candidate for a future spec.
- The vitest-level unit test on `maybeBlockMutationUnderImpersonation`
  called out in the 2026-04-21 brief.
