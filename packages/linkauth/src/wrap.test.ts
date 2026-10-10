import { getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { hasValidSignature } from "./signature.js";
import { authTemplate } from "./template.js";
import { NONCE, newKey, signLogin, wrapAt } from "./testing/fixtures.js";
import {
  LINKAUTH_WRAP_KIND,
  nonceHash,
  unwrapAssertion,
  wrapAssertion,
} from "./wrap.js";

describe("wrapAssertion", () => {
  const userKey = newKey();
  const domainKey = newKey();
  const assertion = signLogin(userKey);

  it("builds a kind 1059 event from a throwaway key, tagged for the domain and the nonce hash, expiring in 10 minutes", () => {
    const wrap = wrapAssertion(assertion, getPublicKey(domainKey));
    expect(wrap.kind).toBe(LINKAUTH_WRAP_KIND);
    expect(wrap.tags).toEqual([
      ["p", getPublicKey(domainKey)],
      ["x", nonceHash(NONCE)],
      ["expiration", String(wrap.created_at + 600)],
    ]);
    expect(nonceHash(NONCE)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(wrap.tags)).not.toContain(NONCE);
    expect(wrap.pubkey).not.toBe(assertion.pubkey);
    expect(wrap.pubkey).not.toBe(getPublicKey(domainKey));
    expect(
      Math.abs(wrap.created_at - Math.floor(Date.now() / 1000)),
    ).toBeLessThan(5);
    expect(hasValidSignature(wrap)).toBe(true);
    expect(wrap.content).not.toContain(assertion.id);
  });

  it("uses a fresh throwaway key every time", () => {
    const pubkey = getPublicKey(domainKey);
    expect(wrapAssertion(assertion, pubkey).pubkey).not.toBe(
      wrapAssertion(assertion, pubkey).pubkey,
    );
  });

  it("round-trips for the addressed key only", () => {
    const wrap = wrapAssertion(assertion, getPublicKey(domainKey));
    expect(unwrapAssertion(wrap, domainKey)).toEqual(assertion);
    expect(unwrapAssertion(wrap, newKey())).toBeNull();
  });

  it("does not unwrap another kind, a forged signature or non-assertion content", () => {
    const wrap = wrapAssertion(assertion, getPublicKey(domainKey));
    expect(unwrapAssertion({ ...wrap, kind: 1 }, domainKey)).toBeNull();
    expect(
      unwrapAssertion({ ...wrap, sig: "0".repeat(128) }, domainKey),
    ).toBeNull();
    expect(
      unwrapAssertion({ ...wrap, content: "garbage" }, domainKey),
    ).toBeNull();
  });

  it("does not unwrap a wrap whose x tag is missing or is not the hash of its own nonce", () => {
    const domainPubkey = getPublicKey(domainKey);
    const otherNonce = authTemplate({
      audience: "https://shop.example",
      nonce: "m".repeat(43),
    });
    const noTag = wrapAt(assertion, domainPubkey, 1, [["p", domainPubkey]]);
    const wrongTag = wrapAt(assertion, domainPubkey, 1, [
      ["p", domainPubkey],
      ["x", nonceHash(otherNonce.tags[2]?.[1] ?? "")],
    ]);
    expect(unwrapAssertion(noTag, domainKey)).toBeNull();
    expect(unwrapAssertion(wrongTag, domainKey)).toBeNull();
  });

  it("throws for a malformed assertion or one that is not a login", () => {
    expect(() =>
      wrapAssertion(
        signLogin(userKey, { template: { kind: 1, tags: [], content: "hi" } }),
        getPublicKey(domainKey),
      ),
    ).toThrow(TypeError);
    expect(() =>
      wrapAssertion({ ...assertion, sig: "x" }, getPublicKey(domainKey)),
    ).toThrow(TypeError);
  });
});
