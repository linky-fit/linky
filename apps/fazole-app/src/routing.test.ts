import { describe, expect, it } from "vitest";
import { parseRoute, paymentIdOf, resolveRoute } from "./routing";

describe("routing", () => {
  it("reads sections, flows and payments from the hash and falls back to welcome", () => {
    expect(parseRoute("#history")).toBe("history");
    expect(parseRoute("#/setup")).toBe("setup");
    expect(parseRoute("#pay/abc-1_2")).toBe("pay/abc-1_2");
    expect(paymentIdOf(parseRoute("#pay/abc"))).toBe("abc");
    expect(parseRoute("#employees")).toBe("welcome");
    expect(parseRoute("#pay/")).toBe("welcome");
    expect(parseRoute("")).toBe("welcome");
  });

  it("keeps a signed-out device on the welcome flows", () => {
    expect(resolveRoute("setup", "signedOut")).toBe("setup");
    expect(resolveRoute("restore", "signedOut")).toBe("restore");
    expect(resolveRoute("terminal", "signedOut")).toBe("welcome");
    expect(resolveRoute("pay/abc", "signedOut")).toBe("welcome");
    expect(resolveRoute("restoring", "signedOut")).toBe("welcome");
  });

  it("waits for a restored shop and sets up an account that has none", () => {
    expect(resolveRoute("terminal", "syncing")).toBe("restoring");
    expect(resolveRoute("restore", "syncing")).toBe("restoring");
    expect(resolveRoute("setup", "syncing")).toBe("setup");
    expect(resolveRoute("terminal", "noShop")).toBe("setup");
  });

  it("opens sections, payments and another restore once the shop is there", () => {
    expect(resolveRoute("wallet", "ready")).toBe("wallet");
    expect(resolveRoute("pay/abc", "ready")).toBe("pay/abc");
    expect(resolveRoute("restore", "ready")).toBe("restore");
    expect(resolveRoute("welcome", "ready")).toBe("terminal");
    expect(resolveRoute("setup", "ready")).toBe("terminal");
    expect(resolveRoute("restoring", "ready")).toBe("terminal");
  });
});
