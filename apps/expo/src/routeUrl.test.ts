import { describe, expect, it } from "bun:test";
import { routePathFor } from "@linky-fit/linky-app/src/types/route.ts";
import {
  legacyHashTarget,
  routePathForRouter,
  routePathForUrl,
  routerStartUrl,
  urlPathFor,
} from "./routeUrl.ts";

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

describe("routerStartUrl", () => {
  it("drops a command link's fragment and keeps the path and search", () => {
    expect(
      routerStartUrl("https://linky.example/wallet?x=1#wallet?cashu=cashuA")
        .href,
    ).toBe("https://linky.example/wallet?x=1");
  });
});

// expo-router's web history, as in its getStateFromPath / getPathFromState:
// it decodes URL segments (twice on the way through router.push), and
// writes a segment back escaping only what a path segment cannot hold.
const decodeTwice = (segment: string): string =>
  decodeURIComponent(decodeURIComponent(segment));
const routerPathname = (urlPath: string): string =>
  urlPath.split("?")[0]!.split("/").map(decodeTwice).join("/");
const routerUrlPath = (pathname: string): string =>
  pathname
    .split("/")
    .map((segment) =>
      segment.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]/g, (char) =>
        encodeURIComponent(char),
      ),
    )
    .join("/");

describe("route paths through expo-router", () => {
  const freeText = [
    "https://mint.example/Bitcoin?unit=sat#keys",
    "wss://relay.example/a%2Fb",
    "ws://localhost:3338",
    "https://mint.example/ščř/ünicode/😀",
    "100% / done ~ ~~ ~2F",
  ];
  const routePaths = [
    ...freeText.map((text) => routePathFor({ route: "mint", mintUrl: text })),
    ...freeText.map((text) => routePathFor({ route: "nostrRelay", id: text })),
    ...freeText.map((text) => routePathFor({ route: "evoluServer", id: text })),
    routePathFor({
      route: "lnAddressPay",
      lnAddress: "alice+tip@ex/ample.com",
    }),
    // An Evolu id, as keryxSubscriptionIdFor makes them, and a free-text key.
    `settings/keryx/Z7veliBhXFf8WLDbkoFrig/${encodeURIComponent("key/with?#")}`,
    routePathFor({ route: "chat", id: contactId }),
    "wallet/recurring/new?contact=c1&amount=10",
  ];

  it.each(routePaths)("keeps %s through the router's decoding", (routePath) => {
    const store = memoryStore();
    const url = urlPathFor(routePath, store);
    const [, query = ""] = routePath.split("?");
    const pathname = routerPathname(url);

    expect(url.split("?")[0]).not.toContain("%");
    expect(
      routePathForRouter(pathname, new URLSearchParams(query), store),
    ).toBe(routePath);
    // The router writes the same URL back, and reading it gives the route.
    expect(routerUrlPath(pathname)).toBe(url.split("?")[0]);
    expect(
      routePathForUrl(url.split("?")[0]!, query ? `?${query}` : "", store),
    ).toBe(routePath);
  });
});

describe("legacy hashes of URL-bearing routes", () => {
  const encoded = (text: string) => encodeURIComponent(text);
  it.each([
    `nostr-relay/${encoded("ws://localhost:7777")}`,
    `advanced/mint/${encoded("https://mint.example/Bitcoin")}`,
    `evolu-server/${encoded("wss://free.evoluhq.com/a%2Fb")}`,
    `payln/${encoded("alice@ex/ample.com")}`,
    `settings/keryx/Z7veliBhXFf8WLDbkoFrig/${encoded("news/launch")}`,
  ])("moves #%s to a URL that reads back as the same route", (routePath) => {
    const store = memoryStore();
    const target = legacyHashTarget(`#${routePath}`, store);

    expect(target).toBe(urlPathFor(routePath, store));
    expect(target).not.toContain("%");
    expect(routePathForUrl(target ?? "", "", store)).toBe(routePath);
    expect(
      routePathForRouter(
        routerPathname(target ?? ""),
        new URLSearchParams(),
        store,
      ),
    ).toBe(routePath);
  });
});
