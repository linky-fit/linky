import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import { clientIp, InMemoryRateLimiter } from "./requestSecurity";

describe("clientIp", () => {
  test("ignores X-Forwarded-For from an untrusted peer", () => {
    expect(clientIp("203.0.113.9", "198.51.100.1", ["10.0.0.1"])).toBe(
      "203.0.113.9",
    );
  });

  test("walks trusted hops from the right and stops at the first untrusted one", () => {
    const trusted = ["10.0.0.1", "10.0.0.2"];
    expect(
      clientIp("10.0.0.1", "198.51.100.7, 203.0.113.5, 10.0.0.2", trusted),
    ).toBe("203.0.113.5");
  });

  test("falls back to the peer when a trusted proxy forwards garbage", () => {
    expect(clientIp("10.0.0.1", "not-an-ip", ["10.0.0.1"])).toBe("10.0.0.1");
    expect(clientIp(undefined, null, [])).toBe("unknown");
  });

  test("matches an IPv6 proxy whatever case the configuration uses", () => {
    const { trustedProxyIps } = loadConfig({
      BOLT_CARD_BRIDGE_PUBLIC_URL: "https://bridge.example",
      BOLT_CARD_BRIDGE_TRUSTED_PROXY_IPS: "2001:DB8::1",
    });
    expect(clientIp("2001:db8::1", "198.51.100.1", trustedProxyIps)).toBe(
      "198.51.100.1",
    );
  });
});

describe("InMemoryRateLimiter", () => {
  test("allows maxHits per window and starts over after it", () => {
    const limiter = new InMemoryRateLimiter();
    expect(limiter.allow("k", 2, 1_000, 0)).toBe(true);
    expect(limiter.allow("k", 2, 1_000, 10)).toBe(true);
    expect(limiter.allow("k", 2, 1_000, 20)).toBe(false);
    expect(limiter.allow("other", 2, 1_000, 20)).toBe(true);
    expect(limiter.allow("k", 2, 1_000, 1_000)).toBe(true);
  });
});
