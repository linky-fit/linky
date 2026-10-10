import { assert, describe, expect, it } from "vitest";
import { p2pkPubkeyOf, parseP2pkPubkey } from "@linky-fit/linkshu";
import { encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { nostrKeyOptionsOf } from "./useLinkshuComposition";

const xOnly = (pubkey: string) => pubkey.slice(2);

describe("nostrKeyOptionsOf", () => {
  it("unlocks tokens locked to the user's npub with the nostr key", () => {
    const identity = makeIdentity();
    const { unlockOptions } = nostrKeyOptionsOf(encodeNsec(identity.secretKey));
    const lockTo = parseP2pkPubkey(encodeNpub(identity.pubkey));

    assert("unlockingKey" in unlockOptions && lockTo !== null);
    expect(xOnly(p2pkPubkeyOf(unlockOptions.unlockingKey))).toBe(xOnly(lockTo));
  });

  it("gives no keys without a decodable nsec", () => {
    const none = { lockingOptions: {}, unlockOptions: {} };
    expect(nostrKeyOptionsOf(null)).toEqual(none);
    expect(nostrKeyOptionsOf("nsec1invalid")).toEqual(none);
  });
});
