/**
 * Unit tests for recalc-lock helper. We test against a stub Supabase
 * client because the real client requires a live DB + the migration
 * applied. The stub captures rpc calls and returns canned responses
 * matching the Supabase JS client's shape ({ data, error }).
 */

import { describe, it, expect, vi } from "vitest";
import { tryAcquireRecalcLock, releaseRecalcLock } from "./recalc-lock";

const USER_ID = "7f97040f-023d-4604-8b66-f5aa321c31de";

function stubClient(rpcImpl: (fn: string, args: unknown) => unknown) {
  return {
    rpc: vi.fn(async (fn: string, args: unknown) => rpcImpl(fn, args)),
  };
}

describe("tryAcquireRecalcLock", () => {
  it("returns 'acquired' when RPC returns true", async () => {
    const client = stubClient(() => ({ data: true, error: null }));
    const result = await tryAcquireRecalcLock(client, USER_ID);
    expect(result).toBe("acquired");
    expect(client.rpc).toHaveBeenCalledWith("try_acquire_recalc_lock", {
      p_user_id: USER_ID,
    });
  });

  it("returns 'busy' when another recalc is in-flight (RPC returns false)", async () => {
    const client = stubClient(() => ({ data: false, error: null }));
    const result = await tryAcquireRecalcLock(client, USER_ID);
    expect(result).toBe("busy");
  });

  it("returns 'not-installed' on PG 42883 (function does not exist)", async () => {
    const client = stubClient(() => ({
      data: null,
      error: { code: "42883", message: "function try_acquire_recalc_lock(...) does not exist" },
    }));
    const result = await tryAcquireRecalcLock(client, USER_ID);
    expect(result).toBe("not-installed");
  });

  it("returns 'not-installed' on function-name match in error message", async () => {
    // Some Postgres deployments swallow the code field but keep the
    // message — defensive fallback.
    const client = stubClient(() => ({
      data: null,
      error: { code: undefined, message: "could not find try_acquire_recalc_lock" },
    }));
    const result = await tryAcquireRecalcLock(client, USER_ID);
    expect(result).toBe("not-installed");
  });

  it("returns 'not-installed' on unrelated DB error (don't block recalc on lock infra)", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = stubClient(() => ({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    }));
    const result = await tryAcquireRecalcLock(client, USER_ID);
    expect(result).toBe("not-installed");
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("returns 'not-installed' when RPC throws", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = stubClient(() => {
      throw new Error("network down");
    });
    const result = await tryAcquireRecalcLock(client, USER_ID);
    expect(result).toBe("not-installed");
    consoleWarn.mockRestore();
  });
});

describe("releaseRecalcLock", () => {
  it("calls release_recalc_lock RPC with user_id", async () => {
    const client = stubClient(() => ({ data: null, error: null }));
    await releaseRecalcLock(client, USER_ID);
    expect(client.rpc).toHaveBeenCalledWith("release_recalc_lock", {
      p_user_id: USER_ID,
    });
  });

  it("silently swallows 42883 (migration not applied yet)", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = stubClient(() => ({
      data: null,
      error: { code: "42883", message: "function release_recalc_lock(...) does not exist" },
    }));
    await releaseRecalcLock(client, USER_ID);
    // 42883 is silent — it's the expected steady state pre-migration.
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("logs unrelated errors but doesn't throw", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = stubClient(() => ({
      data: null,
      error: { code: "57014", message: "timeout" },
    }));
    // Must not throw — release runs in a finally, can't be allowed to mask the real result.
    await expect(releaseRecalcLock(client, USER_ID)).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("doesn't throw when RPC throws", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = stubClient(() => {
      throw new Error("connection lost");
    });
    await expect(releaseRecalcLock(client, USER_ID)).resolves.toBeUndefined();
    consoleWarn.mockRestore();
  });
});
