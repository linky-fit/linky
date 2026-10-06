import { hexToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { P2pkUnlockingKey, p2pkPubkeyOf, parseP2pkPubkey } from "./p2pk";

const generatorX =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const npub = bech32.encode("npub", bech32.toWords(hexToBytes(generatorX)));

describe("parseP2pkPubkey", () => {
  it("takes the even-y point for x-only hex and npub input", () => {
    expect(parseP2pkPubkey(generatorX)).toBe(`02${generatorX}`);
    expect(parseP2pkPubkey(npub)).toBe(`02${generatorX}`);
    expect(parseP2pkPubkey(` nostr:${npub.toUpperCase()} `)).toBe(
      `02${generatorX}`,
    );
  });

  it("keeps a compressed key as given", () => {
    expect(parseP2pkPubkey(`03${generatorX}`)).toBe(`03${generatorX}`);
  });

  it("rejects text that is not a point on the curve", () => {
    expect(parseP2pkPubkey("02" + "00".repeat(32))).toBeNull();
    expect(parseP2pkPubkey("npub1notakey")).toBeNull();
    expect(parseP2pkPubkey("04" + generatorX)).toBeNull();
  });

  it("derives the compressed pubkey of an unlocking key", () => {
    expect(p2pkPubkeyOf(P2pkUnlockingKey.make("0".repeat(63) + "1"))).toBe(
      `02${generatorX}`,
    );
  });
});
