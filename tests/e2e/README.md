# Impersonation Playwright Suite

End-to-end tests that verify the "impersonation blocks mutation" middleware guard
in [`src/lib/supabase/middleware.ts`](../../src/lib/supabase/middleware.ts).

## What these tests do

1. `global-setup.ts` — logs in as the admin once via `/login` and persists
   cookies to `.auth/admin.storageState.json`.
2. `impersonation-blocks-mutation.spec.ts` — for each of the four user-scoped
   mutation endpoints (Square sync, Toast sync, Clover sync, Team invite), starts
   impersonation and asserts the endpoint returns **403** with header
   `x-impersonation-blocked: 1` and body `{ error: "Read-only impersonation active" }`.
3. `impersonation-admin-routes.spec.ts` — asserts admin-scoped routes
   (`/api/admin/users`, `/api/admin/impersonate/stop`) are NOT blocked by the
   middleware under impersonation. Includes a scaffolded `test.skip` for a
   future admin mutation route.
4. `impersonation-ui-flow.spec.ts` — browser-level smoke: impersonate, click the
   "Sync now" button on `/dashboard/integrations`, assert the network response
   is the middleware 403. Auto-skips if `TARGET_USER_ID` has no connected POS
   provider.

## Running the suite

### 1. Install browsers (first run only)

```bash
npm run test:e2e:install
```

### 2. Set env vars

Create `tests/e2e/.env.e2e` (gitignored) or export these in your shell:

| Var | What it is |
| --- | --- |
| `PLAYWRIGHT_BASE_URL` | Preview or prod URL (e.g. `https://vendcast-git-test-impersonation-playwright-<hash>.vercel.app`) or `http://localhost:3000`. |
| `ADMIN_EMAIL` | Email of an account in the admin allowlist (see `src/lib/admin.ts`). |
| `ADMIN_PASSWORD` | That account's password. |
| `TARGET_USER_ID` | Supabase `auth.users.id` (uuid) of a non-admin test user to impersonate. For the UI flow test to run instead of skip, this user should have at least one POS provider connected. |

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

### 4. Specific specs

```bash
npx playwright test impersonation-blocks-mutation
npx playwright test impersonation-admin-routes
npx playwright test impersonation-ui-flow
```

## Interpreting failures

- **403 missing / 2xx received** on a `BLOCKED_ENDPOINTS` row — the middleware
  guard did not fire for that route. This is the exact shape of the bug the
  `debug/impersonation-block-logging` branch is tracking. Check the diagnostic
  logs the middleware emits (path, cookie length, verify result, gate
  decision) to localize where the guard is dropping the request.
- **403 with `x-impersonation-blocked` missing** — a different gate produced the
  403 (subscription tier, admin check). That is NOT the bug we're testing and
  can happen if, e.g., `TARGET_USER_ID` is on the free tier and the POS sync
  route's own subscription check runs before the middleware — but the
  middleware runs first, so this should not occur in practice. If you see it,
  middleware order is broken.
- **403 on an admin route** (`impersonation-admin-routes.spec.ts` fails) — the
  middleware is over-blocking `/api/admin/*` and admins will get stuck in
  read-only mode. Fix the exempt-path check in the middleware.
- **Setup fails on `/login`** — the login selectors drifted. Update
  `global-setup.ts`.

## What's NOT tested here

- The actual sync job succeeding/failing while NOT impersonating — out of
  scope, covered (or not) by the unit tests.
- The `IMPERSONATION_SIGNING_SECRET` signing path — covered by vitest.
- Expired/forged cookies — would be a useful addition; not included yet.
