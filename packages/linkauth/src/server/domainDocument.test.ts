import { describe, expect, it } from "vitest";
import { parseDomainDocument } from "../domain.js";
import { AUDIENCE, CALLBACK, newKey } from "../testing/fixtures.js";
import { domainDocument, publicKeyOf } from "./domainDocument.js";

const base = {
  audience: AUDIENCE,
  name: "Shop",
  pubkey: publicKeyOf(newKey()),
  relays: ["wss://relay.shop.example"],
  callbacks: [CALLBACK],
};

describe("domainDocument", () => {
  it("builds JSON that signers accept", () => {
    const document = domainDocument({ ...base, icon: `${AUDIENCE}/i.png` });
    expect(document).toEqual({
      version: 1,
      name: "Shop",
      icon: `${AUDIENCE}/i.png`,
      pubkey: base.pubkey,
      relays: base.relays,
      callbacks: base.callbacks,
    });
    expect(
      parseDomainDocument(JSON.parse(JSON.stringify(document)), AUDIENCE).ok,
    ).toBe(true);
  });

  it("omits an absent icon and takes any URL on the origin as the audience", () => {
    const document = domainDocument({ ...base, audience: `${AUDIENCE}/x` });
    expect("icon" in document).toBe(false);
  });

  it("throws when the result would be rejected", () => {
    expect(() => domainDocument({ ...base, callbacks: [] })).toThrow(
      "bad-callbacks",
    );
    expect(() =>
      domainDocument({ ...base, audience: "http://shop.example" }),
    ).toThrow(TypeError);
  });
});
