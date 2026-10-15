import { encodeNpub, Pubkey } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import {
  buildUnknownContactId,
  decodeNpubOnce,
  normalizePubkeyHex,
  readUnknownContactIdPubkey,
} from "./contactIdentity";

describe("normalizePubkeyHex", () => {
  const pubkey = Pubkey.make("a".repeat(64));

  it("canonicalizes hex and npub forms on every call", () => {
    for (let round = 0; round < 2; round += 1) {
      expect(normalizePubkeyHex(` ${"A".repeat(64)} `)).toBe(pubkey);
      expect(normalizePubkeyHex(encodeNpub(pubkey))).toBe(pubkey);
    }
  });

  it("keeps rejecting malformed and off-curve keys on repeated calls", () => {
    for (let round = 0; round < 2; round += 1) {
      expect(normalizePubkeyHex("f".repeat(64))).toBeNull();
      expect(normalizePubkeyHex("not-a-pubkey")).toBeNull();
      expect(normalizePubkeyHex(null)).toBeNull();
    }
  });

  it("decodes only npubs in decodeNpubOnce", () => {
    expect(decodeNpubOnce(encodeNpub(pubkey))).toBe(pubkey);
    expect(decodeNpubOnce(pubkey)).toBeNull();
  });
});

describe("unknown contact ids", () => {
  it("round-trips the peer pubkey", () => {
    const pubkey = "a".repeat(64);
    const contactId = buildUnknownContactId(pubkey);

    expect(contactId).not.toBeNull();
    expect(readUnknownContactIdPubkey(contactId)).toBe(pubkey);
  });

  it("rejects malformed and known contact ids", () => {
    expect(readUnknownContactIdPubkey("unknown:not-a-pubkey")).toBeNull();
    expect(readUnknownContactIdPubkey("contact-id")).toBeNull();
  });
});
