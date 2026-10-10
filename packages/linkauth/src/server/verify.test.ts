import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { authTemplate } from "../template.js";
import { AUDIENCE, NONCE, newKey, signLogin } from "../testing/fixtures.js";
import { verifyLinkauth } from "./verify.js";

const NOW = 1_700_000_000;
const expected = { audience: AUDIENCE, nonce: NONCE, now: NOW };
const key = newKey();
const rawEvent: typeof finalizeEvent = (template, secret) =>
  JSON.parse(JSON.stringify(finalizeEvent(template, secret)));
const login = (createdAt = NOW) => signLogin(key, { createdAt });

describe("verifyLinkauth", () => {
  it("accepts a canonical login and returns the key", () => {
    expect(verifyLinkauth(login(), expected)).toEqual({
      ok: true,
      pubkey: getPublicKey(key),
      createdAt: NOW,
    });
  });

  it("accepts the JSON text and any URL on the audience", () => {
    const result = verifyLinkauth(JSON.stringify(login()), {
      ...expected,
      audience: `${AUDIENCE}/login?x=1`,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["not JSON", "{nope"],
    ["null", null],
    ["a string that is not an event", "hello"],
    ["an event without sig", { ...login(), sig: undefined }],
    ["tags that are not string arrays", { ...login(), tags: [[1]] }],
  ])("rejects %s as malformed", (_name, input) => {
    expect(verifyLinkauth(input, expected)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a bad signature", () => {
    const event = login();
    const forged = { ...event, sig: "0".repeat(128) };
    expect(verifyLinkauth(forged, expected)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a tampered event whose id no longer matches", () => {
    const tampered = { ...login(), content: `Log in to ${AUDIENCE} ` };
    expect(verifyLinkauth(tampered, expected)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a site-chosen NIP-98 event (#546)", () => {
    const nip98 = rawEvent(
      {
        kind: 27235,
        created_at: NOW,
        tags: [
          ["u", `${AUDIENCE}/wallet/withdraw`],
          ["method", "POST"],
        ],
        content: "",
      },
      key,
    );
    expect(verifyLinkauth(nip98, expected)).toEqual({
      ok: false,
      reason: "wrong-kind",
    });
  });

  it("rejects a NIP-42 event", () => {
    const nip42 = rawEvent(
      {
        kind: 22242,
        created_at: NOW,
        tags: [["challenge", NONCE]],
        content: "",
      },
      key,
    );
    expect(verifyLinkauth(nip42, expected).ok).toBe(false);
  });

  it("rejects a NIP-98 event dressed up with the login tags", () => {
    const template = authTemplate({ audience: AUDIENCE, nonce: NONCE });
    const disguised = signLogin(key, {
      createdAt: NOW,
      template: { ...template, kind: 27235 },
    });
    expect(verifyLinkauth(disguised, expected)).toEqual({
      ok: false,
      reason: "wrong-kind",
    });
  });

  it.each([
    [
      "an extra tag",
      (t: ReturnType<typeof authTemplate>) => ({
        ...t,
        tags: [...t.tags, ["u", "https://shop.example/x"]],
      }),
    ],
    [
      "a missing tag",
      (t: ReturnType<typeof authTemplate>) => ({
        ...t,
        tags: t.tags.slice(0, 2),
      }),
    ],
    [
      "reordered tags",
      (t: ReturnType<typeof authTemplate>) => ({
        ...t,
        tags: [t.tags[0] ?? [], t.tags[2] ?? [], t.tags[1] ?? []],
      }),
    ],
    [
      "other content",
      (t: ReturnType<typeof authTemplate>) => ({
        ...t,
        content: "Approve withdrawal",
      }),
    ],
  ])("rejects %s as a wrong template", (_name, mutate) => {
    const event = signLogin(key, {
      createdAt: NOW,
      template: mutate(authTemplate({ audience: AUDIENCE, nonce: NONCE })),
    });
    expect(verifyLinkauth(event, expected)).toEqual({
      ok: false,
      reason: "wrong-template",
    });
  });

  it("rejects another audience, however it is spelled", () => {
    const other = signLogin(key, {
      createdAt: NOW,
      template: authTemplate({
        audience: "https://evil.example",
        nonce: NONCE,
      }),
    });
    expect(verifyLinkauth(other, expected)).toEqual({
      ok: false,
      reason: "wrong-audience",
    });
    const pathful = signLogin(key, {
      createdAt: NOW,
      template: authTemplate({ audience: `${AUDIENCE}/login`, nonce: NONCE }),
    });
    expect(verifyLinkauth(pathful, expected)).toEqual({
      ok: false,
      reason: "wrong-template",
    });
  });

  it("rejects another nonce", () => {
    const result = verifyLinkauth(login(), {
      ...expected,
      nonce: "m".repeat(43),
    });
    expect(result).toEqual({ ok: false, reason: "wrong-nonce" });
  });

  it("enforces the age window", () => {
    expect(verifyLinkauth(login(NOW - 300), expected).ok).toBe(true);
    expect(verifyLinkauth(login(NOW - 301), expected)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(
      verifyLinkauth(login(NOW - 301), { ...expected, maxAgeSeconds: 600 }).ok,
    ).toBe(true);
    expect(verifyLinkauth(login(NOW + 60), expected).ok).toBe(true);
    expect(verifyLinkauth(login(NOW + 61), expected)).toEqual({
      ok: false,
      reason: "from-future",
    });
  });

  it("uses the server clock by default", () => {
    const { audience, nonce } = expected;
    expect(verifyLinkauth(signLogin(key), { audience, nonce }).ok).toBe(true);
    expect(verifyLinkauth(login(), { audience, nonce })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("throws on expectations that are a bug in the caller", () => {
    expect(() =>
      verifyLinkauth(login(), { ...expected, audience: "http://shop.example" }),
    ).toThrow(TypeError);
    expect(() => verifyLinkauth(login(), { ...expected, nonce: "x" })).toThrow(
      TypeError,
    );
  });
});
