#!/usr/bin/env node
// Post-deploy smoke test. Usage:
//   node scripts/smoke-test.mjs [baseUrl]
//   EXPECTED_COMMIT=<sha> node scripts/smoke-test.mjs
//
// Defaults to https://vendcast.co. Exits 0 on success, 1 on any failure.
// Intended to run from CI or a Vercel Deploy Hook after every production deploy.

const DEFAULT_BASE = "https://vendcast.co";
const baseUrl = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
const expectedCommit = process.env.EXPECTED_COMMIT;

const results = [];
let hadFailure = false;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) hadFailure = true;
  const icon = ok ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name}${detail ? " — " + detail : ""}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail);
  } catch (err) {
    record(name, false, err.message);
  }
}

console.log(`Smoke test against ${baseUrl}`);
console.log("");

await check("/api/version returns 200 with a commit", async () => {
  const res = await fetch(`${baseUrl}/api/version`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const body = await res.json();
  if (!body.commit || body.commit === "unknown") {
    throw new Error("commit field missing or unknown");
  }
  if (expectedCommit && !body.commit.startsWith(expectedCommit)) {
    throw new Error(`expected commit ${expectedCommit}, got ${body.commit}`);
  }
  return `commit=${body.commit.slice(0, 7)} env=${body.env} ref=${body.commitRef}`;
});

await check("/ loads (marketing page)", async () => {
  const res = await fetch(baseUrl);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const html = await res.text();
  if (!html.includes("VendCast")) throw new Error("page did not contain 'VendCast'");
  if (html.includes("TruckCast")) throw new Error("page still contains 'TruckCast'");
  return "VendCast branding present, TruckCast absent";
});

await check("/login renders", async () => {
  const res = await fetch(`${baseUrl}/login`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  return `status=${res.status}`;
});

await check("/api/feedback (POST) rejects unauth with 401", async () => {
  // /api/feedback is POST-only — GET returns 405 from Next's method
  // handler. POST without an auth cookie hits the `if (!user)` branch
  // and returns 401. No body needed, auth is checked before parse.
  const res = await fetch(`${baseUrl}/api/feedback`, { method: "POST" });
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  return "auth enforced";
});

await check("/roadmap loads (public)", async () => {
  const res = await fetch(`${baseUrl}/roadmap`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  return `status=${res.status}`;
});

await check("/contact loads (public)", async () => {
  const res = await fetch(`${baseUrl}/contact`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  return `status=${res.status}`;
});

await check("/api/contact (POST) rejects empty body with 400", async () => {
  // Validates the public contact form's server-side validation is live.
  // Empty body trips the "Name is required." branch — no email sent,
  // no rate-limit budget consumed against Julian's inbox.
  const res = await fetch(`${baseUrl}/api/contact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  return "validation enforced";
});

await check("anonymous mutation is NOT middleware-blocked", async () => {
  // Companion to the impersonation block test: POSTing a mutation
  // route without any cookies should return 401 from the route handler
  // (no user) — NOT 403 from the impersonation middleware. A 403 with
  // x-impersonation-blocked: 1 here would mean the middleware is
  // over-firing on no-cookie requests, which would break every anonymous
  // API caller. This is the uncredentialed half of the impersonation
  // regression coverage.
  const res = await fetch(`${baseUrl}/api/pos/square/sync`, { method: "POST" });
  if (res.headers.get("x-impersonation-blocked") === "1") {
    throw new Error("middleware over-blocked anonymous request (403)");
  }
  if (res.status !== 401) {
    throw new Error(`expected 401 from handler, got ${res.status}`);
  }
  return "middleware pass-through, handler 401";
});

console.log("");
if (hadFailure) {
  console.log("Smoke test FAILED");
  process.exit(1);
}
console.log("Smoke test PASSED");
process.exit(0);
