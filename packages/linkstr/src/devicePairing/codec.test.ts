import { hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  encodePairingInvite,
  formatPairingCode,
  pairingCode,
  pairingHelloProof,
  parsePairingInvite,
} from "./codec";

// Computed by Finito's `nostr-account-transfer.ts` and `payky-uri.ts`; a
// mismatch means the two apps can no longer add each other's devices.
const secret = "000102030405060708090a0b0c0d0e0f";
const source =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const target =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const finitoInvite =
  "payky:pair?v=1&pk=79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798&s=000102030405060708090a0b0c0d0e0f&r=wss%3A%2F%2Frelay.one&r=wss%3A%2F%2Frelay.two%2F";

describe("payky:pair, as Finito computes it", () => {
  it("proves a hello and derives the code from the session secret and both keys", () => {
    const sessionSecret = hexToBytes(secret);
    expect(pairingHelloProof(sessionSecret, source, target)).toBe(
      "f90da3379b949004995a97b651d0e320c54347ba426e6397a860fd5afd35641b",
    );
    expect(pairingCode(sessionSecret, source, target)).toBe("704875");
    expect(pairingCode(sessionSecret, target, source)).toBe("366481");
    expect(formatPairingCode("704875")).toBe("704 875");
  });

  it("encodes and reads Finito's invite", () => {
    expect(
      encodePairingInvite({
        pk: source,
        s: secret,
        r: ["wss://relay.one", "wss://relay.two/"],
      }),
    ).toBe(finitoInvite);
    expect(parsePairingInvite(` ${finitoInvite} `)).toMatchObject({
      pk: source,
      s: secret,
      r: ["wss://relay.one", "wss://relay.two/"],
    });
  });

  it("reads no invite of another type, a newer version or a malformed param", () => {
    expect(parsePairingInvite(finitoInvite.replace("pair", "pay"))).toBeNull();
    expect(parsePairingInvite(finitoInvite.replace("v=1", "v=2"))).toBeNull();
    expect(parsePairingInvite(finitoInvite.replace("s=00", "s=zz"))).toBeNull();
    expect(
      parsePairingInvite(`${finitoInvite}&r=wss%3A%2F%2Frelay.three`),
    ).toBeNull();
    expect(parsePairingInvite("nostr:npub1xyz")).toBeNull();
  });
});
