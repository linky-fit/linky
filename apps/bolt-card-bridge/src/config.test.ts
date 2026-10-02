import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const publicUrl = { BOLT_CARD_BRIDGE_PUBLIC_URL: "https://bridge.example" };

describe("loadConfig", () => {
  test("requires a public http(s) URL", () => {
    expect(() => loadConfig({})).toThrow("BOLT_CARD_BRIDGE_PUBLIC_URL");
    expect(() =>
      loadConfig({ BOLT_CARD_BRIDGE_PUBLIC_URL: "bridge.example" }),
    ).toThrow("must be a URL");
    expect(() =>
      loadConfig({ BOLT_CARD_BRIDGE_PUBLIC_URL: "wss://bridge.example" }),
    ).toThrow("must be http(s)");
  });

  test("keeps a base path and drops trailing slashes, query and hash", () => {
    expect(
      loadConfig({
        BOLT_CARD_BRIDGE_PUBLIC_URL: "https://pay.example/bolt-card///?x=1#y",
      }).publicUrl,
    ).toBe("https://pay.example/bolt-card");
    expect(loadConfig(publicUrl).publicUrl).toBe("https://bridge.example");
  });

  test("defaults the optional settings", () => {
    expect(loadConfig(publicUrl)).toMatchObject({
      port: 8789,
      buildCommitSha: "unknown",
      trustedProxyIps: [],
      requestTimeoutMs: 5_000,
      authTimeoutMs: 10_000,
      maxSessionMs: 600_000,
      sessionWaitMs: 3_000,
      maxWaitersPerCard: 4,
      maxWaiters: 1_000,
      ipRateLimitMax: 120,
      cardRateLimitMax: 30,
      rateLimitWindowMs: 60_000,
      debug: "off",
    });
    expect(loadConfig({ ...publicUrl, BOLT_CARD_BRIDGE_PORT: " " }).port).toBe(
      8789,
    );
  });

  test("rejects non-positive numbers", () => {
    for (const value of ["0", "-5", "soon"]) {
      expect(() =>
        loadConfig({
          ...publicUrl,
          BOLT_CARD_BRIDGE_REQUEST_TIMEOUT_MS: value,
        }),
      ).toThrow("BOLT_CARD_BRIDGE_REQUEST_TIMEOUT_MS");
    }
  });

  test("normalizes trusted proxies and rejects anything but IPs", () => {
    expect(
      loadConfig({
        ...publicUrl,
        BOLT_CARD_BRIDGE_TRUSTED_PROXY_IPS: " 10.0.0.1 , 2001:DB8::1 ,",
      }).trustedProxyIps,
    ).toEqual(["10.0.0.1", "2001:db8::1"]);
    expect(() =>
      loadConfig({
        ...publicUrl,
        BOLT_CARD_BRIDGE_TRUSTED_PROXY_IPS: "proxy.internal",
      }),
    ).toThrow();
  });

  test("keeps only a hex build commit, shortened", () => {
    expect(
      loadConfig({ ...publicUrl, BUILD_COMMIT_SHA: "ABCDEF0123456789" })
        .buildCommitSha,
    ).toBe("abcdef012345");
    expect(
      loadConfig({ ...publicUrl, BUILD_COMMIT_SHA: "main" }).buildCommitSha,
    ).toBe("unknown");
  });

  test("reads the debug mode strictly", () => {
    const debug = (value: string) =>
      loadConfig({ ...publicUrl, BOLT_CARD_BRIDGE_DEBUG: value }).debug;
    expect(debug("1")).toBe("redacted");
    expect(debug("TRUE")).toBe("redacted");
    expect(debug("raw")).toBe("raw");
    expect(debug("0")).toBe("off");
    expect(debug("")).toBe("off");
    expect(() => debug("yes")).toThrow("BOLT_CARD_BRIDGE_DEBUG");
  });
});
