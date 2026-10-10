import { getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { parseDomainDocument, plainCallback } from "./domain.js";
import { AUDIENCE, CALLBACK, documentFor, newKey } from "./testing/fixtures.js";

const pubkey = getPublicKey(newKey());
const parse = (overrides: Record<string, unknown>, origin = AUDIENCE) =>
  parseDomainDocument(documentFor(pubkey, overrides), origin);

describe("parseDomainDocument", () => {
  it("accepts a valid document and normalizes what it returns", () => {
    expect(
      parse({ name: "  Shop  ", callbacks: [`${AUDIENCE}/a`, AUDIENCE + "/"] }),
    ).toEqual({
      ok: true,
      domain: {
        name: "Shop",
        icon: `${AUDIENCE}/icon.png`,
        pubkey,
        relays: ["wss://relay.shop.example"],
        callbacks: [`${AUDIENCE}/a`, `${AUDIENCE}/`],
      },
    });
  });

  it("ignores unknown fields and treats the icon as optional", () => {
    const result = parse({ icon: undefined, motto: "buy", extra: { a: 1 } });
    expect(result).toMatchObject({ ok: true, domain: { icon: null } });
    expect(parse({ icon: null })).toMatchObject({ ok: true });
  });

  it("accepts the joiners that emoji sequences and Persian names use", () => {
    expect(parse({ name: "\u{1F469}\u200D\u{1F4BB} Dev shop" })).toMatchObject({
      ok: true,
    });
    expect(
      parse({ name: "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645" }),
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["null", null, "not-an-object"],
    ["an array", [], "not-an-object"],
  ])("rejects %s", (_name, value, problem) => {
    expect(parseDomainDocument(value, AUDIENCE)).toEqual({
      ok: false,
      problem,
    });
  });

  it.each([
    ["version 2", { version: 2 }, "bad-version"],
    ["a string version", { version: "1" }, "bad-version"],
    ["no name", { name: undefined }, "bad-name"],
    ["a blank name", { name: "   " }, "bad-name"],
    ["a numeric name", { name: 7 }, "bad-name"],
    ["a 101 character name", { name: "x".repeat(101) }, "bad-name"],
    ["a name with a newline", { name: "Shop\nBank" }, "bad-name"],
    ["a name with a bidi override", { name: "Shop\u202Ekna" }, "bad-name"],
    ["a name with a zero-width space", { name: "Sh\u200Bop" }, "bad-name"],
    ["a name with a soft hyphen", { name: "Sh\u00ADop" }, "bad-name"],
    ["a name with a line separator", { name: "Shop\u2028Bank" }, "bad-name"],
    [
      "a name with a paragraph separator",
      { name: "Shop\u2029Bank" },
      "bad-name",
    ],
    ["a relative icon", { icon: "/icon.png" }, "bad-icon"],
    ["a cross-origin icon", { icon: "https://cdn.example/i.png" }, "bad-icon"],
    ["an http icon", { icon: "http://shop.example/i.png" }, "bad-icon"],
    [
      "an icon with credentials",
      { icon: "https://a:b@shop.example/i.png" },
      "bad-icon",
    ],
    ["a non-string icon", { icon: 5 }, "bad-icon"],
    ["no pubkey", { pubkey: undefined }, "bad-pubkey"],
    ["an uppercase pubkey", { pubkey: pubkey.toUpperCase() }, "bad-pubkey"],
    ["a short pubkey", { pubkey: pubkey.slice(2) }, "bad-pubkey"],
    ["a pubkey off the curve", { pubkey: "0".repeat(64) }, "bad-pubkey"],
    ["no relays", { relays: [] }, "bad-relays"],
    ["relays that are not a list", { relays: "wss://r.example" }, "bad-relays"],
    [
      "six relays",
      { relays: Array.from({ length: 6 }, (_, i) => `wss://r${i}.example`) },
      "bad-relays",
    ],
    ["an http relay", { relays: ["https://r.example"] }, "bad-relays"],
    [
      "a ws relay on a public origin",
      { relays: ["ws://r.example"] },
      "bad-relays",
    ],
    [
      "a relay with credentials",
      { relays: ["wss://a:b@r.example"] },
      "bad-relays",
    ],
    ["a relay that is not a URL", { relays: ["relay"] }, "bad-relays"],
    [
      "one bad relay among good ones",
      { relays: ["wss://r.example", "nope"] },
      "bad-relays",
    ],
    ["no callbacks", { callbacks: [] }, "bad-callbacks"],
    [
      "eleven callbacks",
      { callbacks: Array.from({ length: 11 }, (_, i) => `${AUDIENCE}/${i}`) },
      "bad-callbacks",
    ],
    [
      "a cross-origin callback",
      { callbacks: ["https://evil.example/cb"] },
      "bad-callbacks",
    ],
    [
      "a callback on a subdomain",
      { callbacks: ["https://www.shop.example/cb"] },
      "bad-callbacks",
    ],
    [
      "a callback with a query",
      { callbacks: [`${CALLBACK}?next=1`] },
      "bad-callbacks",
    ],
    [
      "a callback with an empty query",
      { callbacks: [`${CALLBACK}?`] },
      "bad-callbacks",
    ],
    [
      "a callback with a fragment",
      { callbacks: [`${CALLBACK}#x`] },
      "bad-callbacks",
    ],
    ["a relative callback", { callbacks: ["/login"] }, "bad-callbacks"],
    [
      "one bad callback among good ones",
      { callbacks: [CALLBACK, "nope"] },
      "bad-callbacks",
    ],
  ])("rejects %s", (_name, overrides, problem) => {
    expect(parse(overrides)).toEqual({ ok: false, problem });
  });

  it("allows ws relays and an http icon only for a localhost origin", () => {
    const local = "http://localhost:5173";
    const result = parseDomainDocument(
      documentFor(pubkey, {
        icon: `${local}/i.png`,
        relays: ["ws://localhost:7777"],
        callbacks: [`${local}/cb`],
      }),
      local,
    );
    expect(result.ok).toBe(true);
  });

  it("throws for an origin that is not a normalized origin", () => {
    expect(() => parseDomainDocument({}, "http://shop.example")).toThrow(
      TypeError,
    );
    expect(() => parseDomainDocument({}, `${AUDIENCE}/path`)).toThrow(
      TypeError,
    );
  });
});

describe("plainCallback", () => {
  it("returns the normalized URL for a plain callback on the origin", () => {
    expect(plainCallback(AUDIENCE, `${AUDIENCE}/a/../b`)).toBe(`${AUDIENCE}/b`);
    expect(plainCallback(AUDIENCE, null)).toBeNull();
  });
});
