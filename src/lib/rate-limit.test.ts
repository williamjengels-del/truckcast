import { describe, it, expect } from "vitest";
import { checkRateLimit, clientIpFromRequest } from "./rate-limit";

describe("clientIpFromRequest", () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request("https://vendcast.co/", { headers });
  }

  it("returns the first IP in x-forwarded-for", () => {
    expect(
      clientIpFromRequest(
        reqWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 192.168.0.1" })
      )
    ).toBe("1.2.3.4");
  });

  it("trims whitespace around the first XFF entry", () => {
    expect(
      clientIpFromRequest(reqWith({ "x-forwarded-for": "  5.6.7.8 ,9.9.9.9" }))
    ).toBe("5.6.7.8");
  });

  it("falls back to x-real-ip when x-forwarded-for is empty", () => {
    expect(clientIpFromRequest(reqWith({ "x-real-ip": "11.22.33.44" }))).toBe(
      "11.22.33.44"
    );
  });

  it("returns 'unknown' when neither header is set", () => {
    expect(clientIpFromRequest(reqWith({}))).toBe("unknown");
  });

  it("ignores empty x-forwarded-for and uses x-real-ip", () => {
    expect(
      clientIpFromRequest(
        reqWith({ "x-forwarded-for": "", "x-real-ip": "55.55.55.55" })
      )
    ).toBe("55.55.55.55");
  });
});

describe("checkRateLimit (smoke)", () => {
  it("returns true for first N calls within limit, false on N+1", () => {
    const key = `test:${Math.random()}`;
    expect(checkRateLimit(key, 3, 1000)).toBe(true);
    expect(checkRateLimit(key, 3, 1000)).toBe(true);
    expect(checkRateLimit(key, 3, 1000)).toBe(true);
    expect(checkRateLimit(key, 3, 1000)).toBe(false);
  });

  it("isolates buckets by key", () => {
    const a = `test-a:${Math.random()}`;
    const b = `test-b:${Math.random()}`;
    expect(checkRateLimit(a, 1, 1000)).toBe(true);
    expect(checkRateLimit(b, 1, 1000)).toBe(true); // different key
    expect(checkRateLimit(a, 1, 1000)).toBe(false);
  });
});
