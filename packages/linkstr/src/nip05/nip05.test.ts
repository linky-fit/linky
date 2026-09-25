import { nip19 } from "nostr-tools";
import {
  decodeNip05Document,
  nip05WellKnownUrl,
  parseNip05Identifier,
} from "./nip05";

const pubkeyHex =
  "b0635d6a9851d3aed0cd6c495b282167acf761729078d975fc341b22650b07b9";

describe("parseNip05Identifier", () => {
  it("keeps an explicit domain", () => {
    expect(parseNip05Identifier("Hynek@Nostr.com")).toEqual({
      domain: "nostr.com",
      identifier: "hynek@nostr.com",
      localPart: "hynek",
    });
  });

  it("falls back to the default domain for a bare name", () => {
    expect(parseNip05Identifier("Hynek", "linky.fit")).toEqual({
      domain: "linky.fit",
      identifier: "hynek@linky.fit",
      localPart: "hynek",
    });
  });

  it("rejects a bare name without a default domain", () => {
    expect(parseNip05Identifier("hynek")).toBeNull();
  });

  it("does not treat npubs as identifiers", () => {
    expect(parseNip05Identifier("npub1abc", "linky.fit")).toBeNull();
    expect(parseNip05Identifier("nostr:npub1abc", "linky.fit")).toBeNull();
    expect(parseNip05Identifier("npub1abc@npub.cash")).toBeNull();
  });

  it("rejects a malformed local part or domain", () => {
    expect(parseNip05Identifier("hy nek@nostr.com")).toBeNull();
    expect(parseNip05Identifier("hynek@nostr..com")).toBeNull();
    expect(parseNip05Identifier("hynek@a@b")).toBeNull();
  });
});

describe("nip05WellKnownUrl", () => {
  it("builds the well-known query url", () => {
    const identifier = parseNip05Identifier("hynek@nostr.com");
    assert(identifier !== null);
    expect(nip05WellKnownUrl(identifier).toString()).toBe(
      "https://nostr.com/.well-known/nostr.json?name=hynek",
    );
  });
});

describe("decodeNip05Document", () => {
  const identifier = parseNip05Identifier("hynek@nostr.com");
  assert(identifier !== null);

  it("returns the branded pubkey and its relay hints", () => {
    const result = decodeNip05Document(
      {
        names: { hynek: pubkeyHex },
        relays: {
          [pubkeyHex]: [
            "wss://relay.example.com",
            "https://ignored.test",
            "wss://relay.example.com",
          ],
        },
      },
      identifier,
    );
    assert(result !== null);
    expect(result.pubkey).toBe(pubkeyHex);
    expect(nip19.npubEncode(result.pubkey)).toBe(nip19.npubEncode(pubkeyHex));
    expect(result.relays).toEqual(["wss://relay.example.com"]);
  });

  it("returns null when the name is absent", () => {
    expect(decodeNip05Document({ names: {} }, identifier)).toBeNull();
  });

  it("returns null for a non-hex pubkey", () => {
    expect(
      decodeNip05Document({ names: { hynek: "not-a-key" } }, identifier),
    ).toBeNull();
  });

  it("tolerates a missing relays map", () => {
    const result = decodeNip05Document(
      { names: { hynek: pubkeyHex } },
      identifier,
    );
    assert(result !== null);
    expect(result.relays).toEqual([]);
  });
});
