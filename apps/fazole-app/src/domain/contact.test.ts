import { encodeNpub, parsePubkey } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { nip05Url, parseContactInput, readNip05Response } from "./contact";

const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const pubkey = parsePubkey(hex);
if (pubkey === null) throw new Error("test pubkey");

describe("parseContactInput", () => {
  it("puts a bare name on linky.fit and keeps a full address, lower-cased", () => {
    expect(parseContactInput(" hynek ")).toEqual({
      kind: "nip05",
      name: "hynek",
      domain: "linky.fit",
      address: "hynek@linky.fit",
    });
    expect(parseContactInput("Hynek.Jina@Example.COM")).toMatchObject({
      kind: "nip05",
      address: "hynek.jina@example.com",
    });
  });

  it("takes an npub or a profile link as the key itself", () => {
    expect(parseContactInput(encodeNpub(pubkey))).toEqual({
      kind: "pubkey",
      pubkey,
    });
    expect(
      parseContactInput(`https://linky.fit/p/${encodeNpub(pubkey)}`),
    ).toEqual({ kind: "pubkey", pubkey });
  });

  it("refuses nothing, two @ signs, spaces, a bad domain and a half-typed npub", () => {
    for (const text of [
      "",
      "a@b@c",
      "hynek jina",
      "hynek@localhost",
      "npub1x",
    ]) {
      expect(parseContactInput(text)).toBeNull();
    }
  });
});

describe("the NIP-05 lookup", () => {
  it("asks the domain's nostr.json for the name", () => {
    const input = parseContactInput("hynek");
    if (input?.kind !== "nip05") throw new Error("not a nip05 input");
    expect(nip05Url(input)).toBe(
      "https://linky.fit/.well-known/nostr.json?name=hynek",
    );
  });

  it("reads the key the document names, whatever else it holds", () => {
    expect(
      readNip05Response({ names: { hynek: hex.toUpperCase() } }, "hynek"),
    ).toBe(pubkey);
    expect(readNip05Response({ names: { other: hex } }, "hynek")).toBeNull();
    expect(
      readNip05Response({ names: { hynek: "nonsense" } }, "hynek"),
    ).toBeNull();
    expect(readNip05Response({ names: null }, "hynek")).toBeNull();
    expect(readNip05Response("[]", "hynek")).toBeNull();
  });
});
