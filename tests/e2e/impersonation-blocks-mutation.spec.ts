import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./global-setup";
import { startImpersonation, stopImpersonation } from "./helpers/impersonation";

// Verifies the "impersonation blocks mutation" middleware guard in
// src/lib/supabase/middleware.ts:54-135. For each mutation endpoint an
// admin might reach while impersonating a user, we expect:
//   - status 403
//   - header x-impersonation-blocked: "1"
//   - body.error === "Read-only impersonation active"
//
// Any 2xx/4xx response OTHER than this 403 is a middleware bypass and a
// bug — the whole point of the guard is that no mutation route should
// be reachable while a signed vc_impersonate cookie is present.

const TARGET_USER_ID = process.env.TARGET_USER_ID!;

// Four mutation endpoints the guard is supposed to cover: the three POS
// sync providers + team invite. SumUp's /authorize is a GET OAuth
// redirect, not a mutation — it's deliberately excluded. If a 4th POS
// sync POST exists later, add it here.
const BLOCKED_ENDPOINTS: Array<{
  name: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
}> = [
  { name: "Square sync", method: "POST", path: "/api/pos/square/sync" },
  { name: "Toast sync", method: "POST", path: "/api/pos/toast/sync" },
  { name: "Clover sync", method: "POST", path: "/api/pos/clover/sync" },
  {
    name: "Team invite",
    method: "POST",
    path: "/api/team/invite",
    body: { email: "blocked-test@example.invalid", role: "crew" },
  },
];

test.describe("impersonation blocks mutations on user-scoped API routes", () => {
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
    await stopImpersonation(admin);
    await admin.dispose();
  });

  for (const ep of BLOCKED_ENDPOINTS) {
    test(`${ep.method} ${ep.path} (${ep.name}) is blocked with 403`, async () => {
      const res = await admin.fetch(ep.path, {
        method: ep.method,
        data: ep.body ?? {},
      });

      const status = res.status();
      const header = res.headers()["x-impersonation-blocked"] ?? null;
      const text = await res.text();

      // Primary assertion — status. If this fails with 200/201 the route
      // ran the real handler under impersonation and the middleware was
      // bypassed: a real security bug.
      expect(
        status,
        `${ep.method} ${ep.path} expected 403 from middleware; ` +
          `got ${status}. Header x-impersonation-blocked=${header}. ` +
          `Body: ${text.slice(0, 400)}`
      ).toBe(403);

      // Secondary — the guard header uniquely identifies the middleware
      // as the source of the 403 (vs. the route handler's own 403 for
      // subscription tier or admin gate).
      expect(header, "x-impersonation-blocked header missing").toBe("1");

      const body = JSON.parse(text);
      expect(body.error).toBe("Read-only impersonation active");
    });
  }
});
