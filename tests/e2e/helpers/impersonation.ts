import { APIRequestContext, expect } from "@playwright/test";

export const IMPERSONATION_COOKIE = "vc_impersonate";

// Calls POST /api/admin/impersonate/start with the admin request context,
// returning the signed vc_impersonate cookie value. The cookie is also
// stored in the request context's cookie jar automatically — callers do
// not need to set it again; returning the value is purely for debugging
// / manual cookie manipulation in tests that need to strip it.
export async function startImpersonation(
  admin: APIRequestContext,
  targetUserId: string
): Promise<{ cookieValue: string; expiresAt: number }> {
  const res = await admin.post("/api/admin/impersonate/start", {
    data: { userId: targetUserId },
  });
  expect(
    res.ok(),
    `start-impersonation failed: ${res.status()} ${await res.text()}`
  ).toBe(true);
  const body = await res.json();

  // Pull the freshly set cookie out of storage so individual tests can
  // reason about its value if they need to (e.g. set it manually on a
  // fresh context to simulate a fresh browser).
  const state = await admin.storageState();
  const host = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
  ).hostname;
  const cookie = state.cookies.find(
    (c) => c.name === IMPERSONATION_COOKIE && c.domain.endsWith(host)
  );
  if (!cookie) {
    throw new Error(
      `start-impersonation: response OK (status ${res.status()}) ` +
        `but ${IMPERSONATION_COOKIE} cookie not in jar. ` +
        `Response body: ${JSON.stringify(body)}`
    );
  }
  return { cookieValue: cookie.value, expiresAt: body.expiresAt };
}

export async function stopImpersonation(admin: APIRequestContext): Promise<void> {
  // Admin route: the middleware exempts /api/admin/* so this continues
  // to work even while impersonation is active.
  await admin.post("/api/admin/impersonate/stop");
}
