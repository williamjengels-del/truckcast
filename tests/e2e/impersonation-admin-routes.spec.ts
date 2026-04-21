import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./global-setup";
import { startImpersonation, stopImpersonation } from "./helpers/impersonation";

// The middleware guard exempts /api/admin/* so that admins can still
// stop impersonation, manage users, etc. while a session is active.
// This suite pins that carve-out: admin-scoped routes must NOT return a
// middleware-origin 403 (i.e. must not have x-impersonation-blocked: 1)
// while impersonation is active.
//
// Note: the route handler is still allowed to return a 4xx for its own
// reasons (bad body, missing auth, etc.). We only assert on the
// middleware header/shape — not on business-logic success.

const TARGET_USER_ID = process.env.TARGET_USER_ID!;

// Admin endpoints that should be reachable under impersonation.
// impersonate/stop is the critical one — if it were blocked, the admin
// would be permanently stuck in read-only mode.
const ADMIN_ENDPOINTS: Array<{
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
}> = [
  { name: "admin users list", method: "GET", path: "/api/admin/users" },
  { name: "admin impersonate stop", method: "POST", path: "/api/admin/impersonate/stop" },
];

test.describe("admin-scoped routes remain reachable under impersonation", () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await pwRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL,
      storageState: ADMIN_STORAGE_STATE,
      ignoreHTTPSErrors: true,
    });
    await startImpersonation(admin, TARGET_USER_ID);
  });

  test.afterEach(async () => {
    await stopImpersonation(admin).catch(() => {
      /* already stopped by a test — fine */
    });
    await admin.dispose();
  });

  for (const ep of ADMIN_ENDPOINTS) {
    test(`${ep.method} ${ep.path} (${ep.name}) is not middleware-blocked`, async () => {
      const res = await admin.fetch(ep.path, {
        method: ep.method,
        data: ep.body,
      });
      const header = res.headers()["x-impersonation-blocked"] ?? null;
      expect(
        header,
        `${ep.path} was blocked by impersonation middleware ` +
          `(status ${res.status()}); admin routes must be exempt.`
      ).toBeNull();
    });
  }
});

// Placeholder for a future admin-only mutation route (e.g. something
// under /api/admin/* that writes). The file currently scaffolds a skip
// so a new admin mutation route gets coverage without needing a new
// spec file. Flip test.skip -> test once such a route exists.
test.describe("future: admin-only mutation under impersonation", () => {
  test.skip("POST /api/admin/<future-mutation-route> is not middleware-blocked", async () => {
    // Intentionally empty — unskip and fill in once a write-oriented
    // admin route (beyond impersonate/stop) ships. The assertion is
    // identical to the suite above: expect x-impersonation-blocked to
    // be absent on the response.
  });
});
