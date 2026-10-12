import { describe, expect, it } from "bun:test";
import { legacyHashTarget, routePathForUrl, urlPathFor } from "./routeUrl.ts";

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => void values.set(key, value),
    values,
  };
};

const spd = "SPD*1.0*ACC:CZ6508000000192000145399*AM:1.00*MSG:rent";
const contactId = "a".repeat(64);

describe("legacyHashTarget", () => {
  it.each([
    ["#contacts", "/contacts"],
    ["#wallet/transactions", "/wallet/transactions"],
    [`#chat/${contactId}`, `/chat/${contactId}`],
    [
      "#wallet/recurring/new?contact=c1&amount=10",
      "/wallet/recurring/new?contact=c1&amount=10",
    ],
  ])("moves %s to %s", (hash, target) => {
    expect(legacyHashTarget(hash, memoryStore())).toBe(target);
  });

  it.each([
    ["an add-contact link", "#add/npub1abc"],
    ["a linkauth link", "#linkauth?nonce=n&cb=https%3A%2F%2Fsite.example"],
    ["a nostrconnect link", "#nostrconnect://abc?secret=s3cr3t"],
    ["a cashu protocol link", "#wallet?cashu=cashuAeyJ0b2tlbiI6W119"],
    ["a notification open", "#contacts?notificationOpen=%7B%7D"],
    ["no fragment", ""],
  ])("leaves %s to its command handler", (_name, hash) => {
    expect(legacyHashTarget(hash, memoryStore())).toBeNull();
  });

  it("moves a bank payment to a URL without its SPAYD", () => {
    const store = memoryStore();
    const target = legacyHashTarget(
      `#wallet/bank-payment/${encodeURIComponent(spd)}`,
      store,
    );
    expect(target).toMatch(/^\/wallet\/bank-payment\/spd-[0-9a-f]+$/);
    expect(target).not.toContain("CZ65");
  });
});

describe("bank payment URLs", () => {
  it("round-trips the SPAYD through the store, edit suffix included", () => {
    const store = memoryStore();
    const routePath = `wallet/bank-payment/${encodeURIComponent(spd)}/edit`;
    const url = urlPathFor(routePath, store);
    expect(url).toMatch(/^\/wallet\/bank-payment\/spd-[0-9a-f]+\/edit$/);
    expect(routePathForUrl(url, "", store)).toBe(routePath);
  });

  it("reuses the id of a payload already stored", () => {
    const store = memoryStore();
    const routePath = `wallet/bank-payment/${encodeURIComponent(spd)}`;
    expect(urlPathFor(routePath, store)).toBe(urlPathFor(routePath, store));
  });

  it("opens the wallet for an id this tab never stored", () => {
    expect(
      routePathForUrl("/wallet/bank-payment/spd-0123", "", memoryStore()),
    ).toBe("wallet");
  });
});

describe("urlPathFor", () => {
  it("keeps a route's path and query", () => {
    expect(urlPathFor("wallet/recurring/new?contact=c1", memoryStore())).toBe(
      "/wallet/recurring/new?contact=c1",
    );
    expect(urlPathFor("contacts", memoryStore())).toBe("/contacts");
  });

  it("opens / for a path that is no route, such as a command link's payload", () => {
    expect(urlPathFor("cashuAeyJ0b2tlbiI6W119", memoryStore())).toBe("/");
    expect(urlPathFor("", memoryStore())).toBe("/");
  });
});

describe("routePathForUrl", () => {
  it("drops the leading and trailing slash and keeps the search", () => {
    expect(routePathForUrl("/contacts/", "", memoryStore())).toBe("contacts");
    expect(
      routePathForUrl("/wallet/recurring/new", "?contact=c1", memoryStore()),
    ).toBe("wallet/recurring/new?contact=c1");
  });
});
