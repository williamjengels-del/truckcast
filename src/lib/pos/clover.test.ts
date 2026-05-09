/**
 * Unit tests for Clover 401-detect path (pos-7).
 *
 * Stub global.fetch so we can assert the typed-error branch fires on
 * 401 responses and falls through to the generic error on other non-OK
 * responses. We intentionally don't cover the OAuth callback path
 * here (that's a route test, not a lib test).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CloverAuthExpiredError,
  fetchCloverOrders,
  getCloverMerchant,
} from "./clover";

const ACCESS_TOKEN = "fake_token";
const MERCHANT_ID = "MERCHANT123";

let realFetch: typeof globalThis.fetch | undefined;

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  if (realFetch) globalThis.fetch = realFetch;
});

function mockFetchOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof globalThis.fetch;
}

describe("getCloverMerchant", () => {
  it("returns merchant on 200", async () => {
    mockFetchOnce(200, { id: MERCHANT_ID, name: "Wok-O Taco" });
    const result = await getCloverMerchant(ACCESS_TOKEN, MERCHANT_ID);
    expect(result).toEqual({ id: MERCHANT_ID, name: "Wok-O Taco" });
  });

  it("throws CloverAuthExpiredError on 401 (pos-7)", async () => {
    mockFetchOnce(401, { error: "invalid_token" });
    await expect(getCloverMerchant(ACCESS_TOKEN, MERCHANT_ID)).rejects.toBeInstanceOf(
      CloverAuthExpiredError
    );
  });

  it("CloverAuthExpiredError carries the clover_auth_expired code", async () => {
    mockFetchOnce(401, {});
    try {
      await getCloverMerchant(ACCESS_TOKEN, MERCHANT_ID);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CloverAuthExpiredError);
      expect((e as CloverAuthExpiredError).code).toBe("clover_auth_expired");
    }
  });

  it("throws plain Error (not CloverAuthExpiredError) on 500", async () => {
    mockFetchOnce(500, { error: "server" });
    try {
      await getCloverMerchant(ACCESS_TOKEN, MERCHANT_ID);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(CloverAuthExpiredError);
    }
  });

  it("throws plain Error (not auth-expired) on 403", async () => {
    // 403 is permission, not token expiry — different recovery path,
    // shouldn't trigger the reconnect prompt.
    mockFetchOnce(403, { error: "forbidden" });
    try {
      await getCloverMerchant(ACCESS_TOKEN, MERCHANT_ID);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).not.toBeInstanceOf(CloverAuthExpiredError);
    }
  });
});

describe("fetchCloverOrders", () => {
  it("throws CloverAuthExpiredError on 401 (pos-7)", async () => {
    mockFetchOnce(401, { error: "invalid_token" });
    await expect(
      fetchCloverOrders(ACCESS_TOKEN, MERCHANT_ID, "2026-05-08", "2026-05-08")
    ).rejects.toBeInstanceOf(CloverAuthExpiredError);
  });

  it("returns empty array on 200 with empty elements", async () => {
    mockFetchOnce(200, { elements: [] });
    const orders = await fetchCloverOrders(
      ACCESS_TOKEN,
      MERCHANT_ID,
      "2026-05-08",
      "2026-05-08"
    );
    expect(orders).toEqual([]);
  });
});
