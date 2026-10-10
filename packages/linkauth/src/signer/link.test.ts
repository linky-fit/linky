import { getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { decodeAssertion } from "../callback.js";
import { readCallback } from "../client/index.js";
import { authTemplate } from "../template.js";
import {
  AUDIENCE,
  CALLBACK,
  documentFor,
  fakeFetch,
  NONCE,
  newKey,
  serving,
  signLogin,
} from "../testing/fixtures.js";
import {
  buildCallbackUrl,
  isLinkauthLink,
  parseLinkauthLink,
  resolveLinkauthLink,
} from "./link.js";

const link = (
  params: Record<string, string>,
  base = "https://app.linky.fit/",
) => `${base}#linkauth?${new URLSearchParams(params)}`;
const valid = { o: AUDIENCE, n: NONCE };
const withCallback = { ...valid, cb: CALLBACK };

describe("parseLinkauthLink", () => {
  it("reads the origin, nonce and an optional callback", () => {
    expect(parseLinkauthLink(link(valid))).toEqual({
      audience: AUDIENCE,
      nonce: NONCE,
      callback: null,
    });
    expect(parseLinkauthLink(link(withCallback))).toEqual({
      audience: AUDIENCE,
      nonce: NONCE,
      callback: CALLBACK,
    });
  });

  it("takes the fragment alone too", () => {
    expect(
      parseLinkauthLink(`#linkauth?${new URLSearchParams(valid)}`)?.audience,
    ).toBe(AUDIENCE);
    expect(
      parseLinkauthLink(`linkauth?${new URLSearchParams(valid)}`)?.audience,
    ).toBe(AUDIENCE);
  });

  it("ignores any other parameter a link carries", () => {
    const parsed = parseLinkauthLink(
      link({ ...valid, audience: "https://bank.example", name: "Bank" }),
    );
    expect(parsed).toEqual({
      audience: AUDIENCE,
      nonce: NONCE,
      callback: null,
    });
  });

  it("allows a localhost origin over http", () => {
    const origin = "http://localhost:5173";
    expect(
      parseLinkauthLink(link({ o: origin, n: NONCE, cb: `${origin}/cb` }))
        ?.callback,
    ).toBe(`${origin}/cb`);
  });

  it.each([
    [
      "the removed callback shape",
      { callback: CALLBACK, nonce: NONCE, name: "Shop" },
    ],
    ["a missing origin", { n: NONCE }],
    ["a missing nonce", { o: AUDIENCE }],
    ["a short nonce", { ...valid, n: "abc" }],
    ["an http origin", { ...valid, o: "http://shop.example" }],
    ["an origin with a path", { ...valid, o: `${AUDIENCE}/path` }],
    ["an origin with credentials", { ...valid, o: "https://a:b@shop.example" }],
    ["a non-web origin", { ...valid, o: "javascript:alert(1)" }],
    [
      "a callback on another origin",
      { ...valid, cb: "https://evil.example/cb" },
    ],
    ["a callback with a query", { ...valid, cb: `${CALLBACK}?next=1` }],
    ["a callback with a fragment", { ...valid, cb: `${CALLBACK}#x` }],
    ["an empty callback", { ...valid, cb: "" }],
    ["a relative callback", { ...valid, cb: "/login/done" }],
  ])("rejects %s", (_name, params) => {
    expect(parseLinkauthLink(link(params))).toBeNull();
  });

  it("rejects repeated parameters instead of picking one", () => {
    const base = `https://app.linky.fit/#linkauth?${new URLSearchParams(withCallback)}`;
    expect(
      parseLinkauthLink(
        `${base}&o=${encodeURIComponent("https://evil.example")}`,
      ),
    ).toBeNull();
    expect(
      parseLinkauthLink(
        `${base}&cb=${encodeURIComponent(`${AUDIENCE}/other`)}`,
      ),
    ).toBeNull();
  });

  it("rejects other fragments", () => {
    expect(parseLinkauthLink("https://app.linky.fit/#contacts")).toBeNull();
    expect(parseLinkauthLink("nostrconnect://abc")).toBeNull();
  });
});

describe("isLinkauthLink", () => {
  it("recognizes the shape even when the link is unusable", () => {
    expect(isLinkauthLink(link(valid))).toBe(true);
    expect(isLinkauthLink("#linkauth?o=nope")).toBe(true);
    expect(isLinkauthLink("https://app.linky.fit/#contacts")).toBe(false);
    expect(isLinkauthLink("npub1abc")).toBe(false);
  });
});

describe("resolveLinkauthLink", () => {
  const domainKey = newKey();
  const pubkey = getPublicKey(domainKey);
  const template = authTemplate({ audience: AUDIENCE, nonce: NONCE });

  it("verifies the domain and delivers over Nostr when there is no callback", async () => {
    const { fetch, requests } = serving(documentFor(pubkey));
    expect(await resolveLinkauthLink(link(valid), { fetch })).toEqual({
      ok: true,
      login: {
        audience: AUDIENCE,
        nonce: NONCE,
        template,
        domain: {
          name: "Shop",
          icon: `${AUDIENCE}/icon.png`,
          pubkey,
          relays: ["wss://relay.shop.example"],
        },
        delivery: {
          kind: "nostr",
          pubkey,
          relays: ["wss://relay.shop.example"],
        },
      },
    });
    expect(requests.map((request) => request.url)).toEqual([
      `${AUDIENCE}/.well-known/linkauth.json`,
    ]);
  });

  it("delivers to a callback the document lists, compared after normalization", async () => {
    const { fetch } = serving(
      documentFor(pubkey, {
        callbacks: [
          "https://shop.example/a/../login/done",
          `${AUDIENCE}/other`,
        ],
      }),
    );
    const result = await resolveLinkauthLink(link(withCallback), { fetch });
    expect(result).toMatchObject({
      ok: true,
      login: { delivery: { kind: "callback", url: CALLBACK } },
    });
  });

  it("refuses a callback the document does not list", async () => {
    const { fetch } = serving(documentFor(pubkey));
    expect(
      await resolveLinkauthLink(
        link({ ...valid, cb: `${AUDIENCE}/elsewhere` }),
        { fetch },
      ),
    ).toEqual({ ok: false, reason: "callback-not-listed" });
  });

  it("fails closed when the domain cannot be verified", async () => {
    const down = fakeFetch(() => Promise.reject(new Error("offline")));
    expect(
      await resolveLinkauthLink(link(valid), { fetch: down.fetch }),
    ).toEqual({
      ok: false,
      reason: "unverified-domain",
      detail: "unreachable",
    });
    const bad = serving(
      documentFor(pubkey, { callbacks: ["https://evil.example/cb"] }),
    );
    expect(
      await resolveLinkauthLink(link(withCallback), { fetch: bad.fetch }),
    ).toEqual({
      ok: false,
      reason: "unverified-domain",
      detail: "invalid-document:bad-callbacks",
    });
  });

  it("does not fetch for a link that is not usable", async () => {
    const { fetch, requests } = serving(documentFor(pubkey));
    expect(await resolveLinkauthLink("npub1abc", { fetch })).toEqual({
      ok: false,
      reason: "not-a-linkauth-link",
    });
    expect(
      await resolveLinkauthLink(link({ ...valid, cb: `${CALLBACK}?x=1` }), {
        fetch,
      }),
    ).toEqual({
      ok: false,
      reason: "malformed-link",
    });
    expect(requests).toHaveLength(0);
  });
});

describe("buildCallbackUrl", () => {
  const assertion = signLogin(newKey());

  it("puts the signed event in the fragment and round-trips", () => {
    const url = buildCallbackUrl(CALLBACK, assertion);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(CALLBACK);
    expect(parsed.hash.startsWith("#linkauth=")).toBe(true);
    expect(readCallback(url)).toEqual({ assertion });
    expect(decodeAssertion(parsed.hash.slice("#linkauth=".length))).toEqual(
      assertion,
    );
  });

  it("replaces an existing fragment", () => {
    expect(buildCallbackUrl(`${AUDIENCE}/cb#old`, "denied")).toBe(
      `${AUDIENCE}/cb#linkauth_error=denied`,
    );
  });

  it("reports denial", () => {
    expect(readCallback(buildCallbackUrl(CALLBACK, "denied"))).toEqual({
      error: "denied",
    });
  });

  it("refuses a callback it would not have accepted", () => {
    expect(() => buildCallbackUrl("http://shop.example/cb", "denied")).toThrow(
      TypeError,
    );
  });
});
