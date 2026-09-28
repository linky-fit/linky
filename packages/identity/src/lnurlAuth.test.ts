import { NostrSecretKey } from "@linky-fit/linkstr";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  deriveLnurlAuthPublicKeyHex,
  normalizeLnurlAuthDomain,
  signLnurlAuthChallenge,
} from "./lnurlAuth";

const secretKeyOf = (fill: number): NostrSecretKey =>
  NostrSecretKey.make(new Uint8Array(32).fill(fill));

const ALICE = secretKeyOf(1);
const BOB = secretKeyOf(2);
const CHALLENGE = hexToBytes(
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
);

describe("lnurl-auth linking keys", () => {
  it("returns the same key for the same identity and domain", () => {
    expect(deriveLnurlAuthPublicKeyHex(ALICE, "example.com")).toBe(
      deriveLnurlAuthPublicKeyHex(ALICE, "example.com"),
    );
  });

  it("returns an unlinkable key per domain and per identity", () => {
    const aliceHere = deriveLnurlAuthPublicKeyHex(ALICE, "example.com");

    expect(aliceHere).not.toBe(
      deriveLnurlAuthPublicKeyHex(ALICE, "other.example.com"),
    );
    expect(aliceHere).not.toBe(deriveLnurlAuthPublicKeyHex(BOB, "example.com"));
  });

  it("ignores domain casing and a trailing root dot", () => {
    const expected = deriveLnurlAuthPublicKeyHex(ALICE, "example.com");

    expect(deriveLnurlAuthPublicKeyHex(ALICE, "ExAmple.COM")).toBe(expected);
    expect(deriveLnurlAuthPublicKeyHex(ALICE, " example.com. ")).toBe(expected);
    expect(normalizeLnurlAuthDomain(" ExAmple.COM. ")).toBe("example.com");
  });

  it("produces a compressed public key and a signature the domain can verify", () => {
    const { publicKeyHex, signatureHex } = signLnurlAuthChallenge({
      challenge: CHALLENGE,
      domain: "example.com",
      nostrSecretKey: ALICE,
    });

    expect(publicKeyHex).toBe(
      deriveLnurlAuthPublicKeyHex(ALICE, "example.com"),
    );
    expect(publicKeyHex).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(
      secp256k1.verify(
        hexToBytes(signatureHex),
        CHALLENGE,
        hexToBytes(publicKeyHex),
      ),
    ).toBe(true);
  });

  it("does not verify against another domain's linking key", () => {
    const { signatureHex } = signLnurlAuthChallenge({
      challenge: CHALLENGE,
      domain: "example.com",
      nostrSecretKey: ALICE,
    });

    expect(
      secp256k1.verify(
        hexToBytes(signatureHex),
        CHALLENGE,
        hexToBytes(deriveLnurlAuthPublicKeyHex(ALICE, "evil.example.com")),
      ),
    ).toBe(false);
  });

  it("rejects a challenge that is not 32 bytes", () => {
    expect(() =>
      signLnurlAuthChallenge({
        challenge: new Uint8Array(31),
        domain: "example.com",
        nostrSecretKey: ALICE,
      }),
    ).toThrow();
  });
});
